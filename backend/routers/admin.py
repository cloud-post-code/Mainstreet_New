import csv
import io
import json
import uuid
from decimal import Decimal, InvalidOperation
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, or_
from agent.uploads import public_api_base, shop_logo_url, shops_dir
from agent.upload_safety import read_capped, validate_image_bytes
from db.database import get_db
from db.models import Shop, Product, ProductVariant, User
from db.schemas import ImportResult, ShopOut, ShopCreate, ProductOut, AdminProductsPage
from auth import get_admin_user
from agent.embeddings import build_canonical_text, embed_texts
from utils.db_helpers import get_or_404
from utils.csv_export import csv_safe as _csv_safe, csv_response as _csv_response  # re-exported for tests

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_CSV_BYTES = 10 * 1024 * 1024

router = APIRouter(prefix="/api/admin", tags=["admin"])

EXPECTED_COLUMNS = {
    "shop_name", "product_handle", "base_product_name", "product_name",
    "variant_id", "variant_index", "option_names", "option_values",
    "price", "quantity", "image_url", "description_json",
}
OPTIONAL_COLUMNS = {"parent_store"}
SHOP_EXPECTED_COLUMNS = {"name"}


def _split_options(raw: str) -> list[str]:
    """Shopify uses ' / ' to join compound options (e.g. 'Raw Polished / Fine').
    Split on slash but preserve single-option values as a one-element list."""
    if not raw:
        return []
    return [p.strip() for p in raw.split("/") if p.strip()]


def _hydrate_product_out(product: Product, shop_name: str | None, variants: list[ProductVariant]) -> ProductOut:
    """Build a ProductOut with the variant list, price_range, and a default
    image_url derived from the default (or first) variant. Frontend uses this
    image_url when rendering the parent card before any dropdown selection."""
    from db.schemas import VariantOut, PriceRange
    variant_outs = [VariantOut.model_validate(v) for v in variants]
    default_id = product.default_variant_id
    default_variant = next((v for v in variants if v.id == default_id), None) or (variants[0] if variants else None)
    price_range = None
    in_stock = False
    image_url = None
    if variants:
        prices = [v.price for v in variants if v.price is not None]
        if prices:
            price_range = PriceRange(min=min(prices), max=max(prices))
        in_stock = any((v.quantity or 0) > 0 for v in variants)
    if default_variant is not None:
        image_url = default_variant.image_url
    return ProductOut(
        id=product.id,
        shop_id=product.shop_id,
        parent_store=None,
        shop_name=shop_name,
        handle=product.handle,
        name=product.name,
        description=product.description,
        default_variant_id=default_variant.id if default_variant else None,
        variants=variant_outs,
        price_range=price_range,
        in_stock=in_stock,
        image_url=image_url,
    )


class UploadResponse(BaseModel):
    image_url: str


@router.post("/shops/upload-logo", response_model=UploadResponse)
async def upload_shop_logo(
    request: Request,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
):
    body = await read_capped(file, MAX_IMAGE_BYTES)
    _, ext = validate_image_bytes(body)
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_path = shops_dir() / filename
    dest_path.write_bytes(body)

    image_url = shop_logo_url(filename, public_api_base(request))
    return UploadResponse(image_url=image_url)


@router.post("/import", response_model=ImportResult)
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await read_capped(file, MAX_CSV_BYTES)
    text = content.decode("utf-8-sig")  # handle BOM
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Empty CSV")

    missing_cols = EXPECTED_COLUMNS - set(reader.fieldnames)
    if missing_cols:
        raise HTTPException(status_code=400, detail=f"Missing columns: {missing_cols}")

    rows_added = 0
    rows_updated = 0
    errors = []

    # Group CSV rows by (shop_name, product_handle). Each group becomes one
    # parent Product; each row in the group becomes one ProductVariant.
    groups: dict[tuple[str, str], list[tuple[int, dict]]] = {}
    for i, row in enumerate(reader, start=2):
        try:
            shop_name = (row.get("shop_name") or "").strip()
            handle = (row.get("product_handle") or "").strip()
            if not shop_name:
                raise ValueError("shop_name is empty")
            if not handle:
                raise ValueError("product_handle is empty")
        except Exception as e:
            errors.append({"row": i, "error": str(e)})
            continue
        groups.setdefault((shop_name, handle), []).append((i, row))

    shop_cache: dict[str, Shop] = {}
    # Defer parent embeddings to a single batched call after the loop.
    to_embed: list[tuple[Product, str, str, dict | None, list[str]]] = []

    for (shop_name, handle), rows in groups.items():
        try:
            # Upsert shop
            if shop_name not in shop_cache:
                result = await db.execute(select(Shop).where(Shop.name == shop_name))
                shop = result.scalars().first()
                if not shop:
                    shop = Shop(name=shop_name)
                    db.add(shop)
                    await db.flush()
                shop_cache[shop_name] = shop
            shop = shop_cache[shop_name]

            # Sort rows by variant_index so index 1 is first.
            def _vi(row: dict) -> int:
                try:
                    return int((row.get("variant_index") or "1").strip() or 1)
                except ValueError:
                    return 1
            rows.sort(key=lambda pair: _vi(pair[1]))
            first_row = rows[0][1]

            base_name = (first_row.get("base_product_name") or first_row.get("product_name") or "").strip()
            if not base_name:
                raise ValueError("base_product_name and product_name are both empty")

            parent_description = None
            raw_desc = (first_row.get("description_json") or "").strip()
            if raw_desc:
                try:
                    parent_description = json.loads(raw_desc)
                except json.JSONDecodeError:
                    parent_description = {"summary": raw_desc}

            # Upsert parent product keyed on (shop_id, handle).
            existing = (await db.execute(
                select(Product).where(
                    Product.shop_id == shop.id, Product.handle == handle
                )
            )).scalars().first()
            if existing:
                existing.name = base_name
                existing.description = parent_description
                existing.shop_name_cached = shop.name
                product = existing
                created_parent = False
                rows_updated += 1
            else:
                product = Product(
                    shop_id=shop.id,
                    handle=handle,
                    name=base_name,
                    description=parent_description,
                    shop_name_cached=shop.name,
                )
                db.add(product)
                await db.flush()
                created_parent = True
                rows_added += 1

            # Gather variant option_values for the embedding canonical text.
            option_value_texts: list[str] = []

            # Upsert variants keyed on (product_id, external_variant_id).
            seen_variant_ids: set[int] = set()
            first_variant_id: int | None = None
            for row_idx, row in rows:
                try:
                    raw_external = (row.get("variant_id") or "").strip()
                    external_id: int | None
                    try:
                        external_id = int(raw_external) if raw_external else None
                    except ValueError:
                        external_id = None

                    variant_label = (row.get("product_name") or base_name).strip()
                    option_names = _split_options(row.get("option_names") or "")
                    option_values = _split_options(row.get("option_values") or "")
                    option_value_texts.extend(option_values)

                    try:
                        price = Decimal((row.get("price") or "0").strip() or "0")
                    except InvalidOperation:
                        raise ValueError(f"Invalid price: {row.get('price')}")

                    try:
                        quantity = int((row.get("quantity") or "0").strip() or "0")
                    except ValueError:
                        raise ValueError(f"Invalid quantity: {row.get('quantity')}")

                    image_url = (row.get("image_url") or "").strip() or None
                    variant_index = _vi(row)

                    variant_description: dict | None = None
                    raw_v_desc = (row.get("description_json") or "").strip()
                    if raw_v_desc:
                        try:
                            variant_description = json.loads(raw_v_desc)
                        except json.JSONDecodeError:
                            variant_description = {"summary": raw_v_desc}

                    variant: ProductVariant | None = None
                    if external_id is not None:
                        variant = (await db.execute(
                            select(ProductVariant).where(
                                ProductVariant.product_id == product.id,
                                ProductVariant.external_variant_id == external_id,
                            )
                        )).scalars().first()
                    if variant is None:
                        variant = ProductVariant(product_id=product.id)
                        db.add(variant)
                    variant.external_variant_id = external_id
                    variant.variant_index = variant_index
                    variant.option_names = option_names
                    variant.option_values = option_values
                    variant.price = price
                    variant.quantity = quantity
                    variant.image_url = image_url
                    variant.variant_label = variant_label
                    variant.description = variant_description
                    await db.flush()
                    seen_variant_ids.add(variant.id)
                    if variant_index == 1 or first_variant_id is None:
                        first_variant_id = variant.id
                except Exception as ve:
                    errors.append({"row": row_idx, "error": str(ve)})

            # Set parent.default_variant_id to the variant_index=1 (or
            # first inserted) variant. Pre-existing default that's still in
            # the import wins.
            if product.default_variant_id not in seen_variant_ids:
                product.default_variant_id = first_variant_id

            # Bookkeeping: parent counts as added only if newly inserted; we
            # already incremented rows_added/rows_updated above. Variants
            # don't get their own counters today.
            to_embed.append((product, shop.name, base_name, parent_description, option_value_texts))

        except Exception as e:
            # Fall back to row-level error on the first row of the group.
            row_no = rows[0][0] if rows else 0
            errors.append({"row": row_no, "error": str(e)})

    # Batch-embed every touched parent in one shot. Failures degrade to NULL
    # (lexical-only retrieval still works for that product).
    if to_embed:
        canonical = []
        for _, shop_name, name, desc, option_value_texts in to_embed:
            base = build_canonical_text(name=name, shop_name=shop_name, description=desc)
            if option_value_texts:
                base = f"{base} | {' '.join(option_value_texts)}"
            canonical.append(base)
        vectors = await embed_texts(canonical)
        for (product, *_), vec in zip(to_embed, vectors):
            if vec is not None:
                product.embedding = vec

    await db.commit()
    return ImportResult(rows_added=rows_added, rows_updated=rows_updated, errors=errors)


@router.post("/import/shops", response_model=ImportResult)
async def import_shops_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Empty CSV")

    if "name" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="Missing required column: name")

    rows_added = 0
    rows_updated = 0
    errors = []

    for i, row in enumerate(reader, start=2):
        try:
            name = row["name"].strip()
            if not name:
                raise ValueError("name is empty")

            logo_url = row.get("logo_url", "").strip() or None
            description = row.get("description", "").strip() or None
            website_url = row.get("website_url", "").strip() or None

            result = await db.execute(select(Shop).where(Shop.name == name))
            existing = result.scalars().first()
            if existing:
                if logo_url is not None:
                    existing.logo_url = logo_url
                if description is not None:
                    existing.description = description
                if website_url is not None:
                    existing.website_url = website_url
                rows_updated += 1
            else:
                db.add(Shop(name=name, logo_url=logo_url, description=description, website_url=website_url))
                rows_added += 1

        except Exception as e:
            errors.append({"row": i, "error": str(e)})

    await db.commit()
    return ImportResult(rows_added=rows_added, rows_updated=rows_updated, errors=errors)


@router.get("/export/products")
async def export_products_csv(
    shop_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    stmt = (
        select(Product, ProductVariant, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .join(ProductVariant, ProductVariant.product_id == Product.id)
        .order_by(Shop.name, Product.name, ProductVariant.variant_index)
    )
    if shop_id:
        stmt = stmt.where(Product.shop_id == shop_id)

    result = await db.execute(stmt)
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "parent_store", "shop_name", "product_handle", "base_product_name", "product_name",
            "variant_id", "variant_index", "option_names", "option_values",
            "price", "quantity", "image_url", "description_json",
        ],
    )
    writer.writeheader()
    for product, variant, shop_name in result.all():
        description_json = ""
        desc = variant.description if variant.description is not None else product.description
        if desc is not None:
            description_json = json.dumps(desc, ensure_ascii=False)
        writer.writerow(
            {
                "parent_store": "",
                "shop_name": _csv_safe(shop_name),
                "product_handle": _csv_safe(product.handle or ""),
                "base_product_name": _csv_safe(product.name),
                "product_name": _csv_safe(variant.variant_label or product.name),
                "variant_id": variant.external_variant_id or "",
                "variant_index": variant.variant_index,
                "option_names": _csv_safe(" / ".join(variant.option_names or [])),
                "option_values": _csv_safe(" / ".join(variant.option_values or [])),
                "price": str(variant.price),
                "quantity": variant.quantity,
                "image_url": _csv_safe(variant.image_url or ""),
                "description_json": _csv_safe(description_json),
            }
        )
    return _csv_response(output.getvalue(), "products.csv")


@router.get("/export/shops")
async def export_shops_csv(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    result = await db.execute(select(Shop).order_by(Shop.name))
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["name", "logo_url", "description", "website_url"])
    writer.writeheader()
    for shop in result.scalars().all():
        writer.writerow(
            {
                "name": _csv_safe(shop.name),
                "logo_url": _csv_safe(shop.logo_url or ""),
                "description": _csv_safe(shop.description or ""),
                "website_url": _csv_safe(shop.website_url or ""),
            }
        )
    return _csv_response(output.getvalue(), "shops.csv")


@router.get("/shops", response_model=list[ShopOut])
async def admin_list_shops(
    limit: int = 200,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    from sqlalchemy import func
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    result = await db.execute(
        select(Shop, func.count(Product.id).label("product_count"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
        .limit(limit)
        .offset(offset)
    )
    shops = []
    for shop, count in result.all():
        out = ShopOut.model_validate(shop)
        out.product_count = count
        shops.append(out)
    return shops


@router.post("/shops", response_model=ShopOut, status_code=201)
async def create_shop(
    body: ShopCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    result = await db.execute(select(Shop).where(Shop.name == body.name))
    if result.scalars().first():
        raise HTTPException(status_code=409, detail="A shop with this name already exists")

    shop = Shop(
        name=body.name,
        logo_url=body.logo_url.strip() if body.logo_url and body.logo_url.strip() else None,
        description=body.description.strip() if body.description and body.description.strip() else None,
        website_url=body.website_url.strip() if body.website_url and body.website_url.strip() else None,
    )
    db.add(shop)
    await db.commit()
    await db.refresh(shop)

    out = ShopOut.model_validate(shop)
    out.product_count = 0
    return out


@router.delete("/shops/{shop_id}", status_code=204)
async def delete_shop(shop_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    shop = await get_or_404(db, Shop, shop_id, detail="Shop not found")
    await db.delete(shop)
    await db.commit()


@router.get("/products", response_model=AdminProductsPage)
async def admin_list_products(
    shop_id: int | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    if limit <= 0:
        limit = 100

    base = select(Product, Shop.name.label("shop_name")).join(Shop, Shop.id == Product.shop_id)
    count_stmt = select(func.count(Product.id)).join(Shop, Shop.id == Product.shop_id)

    if shop_id:
        base = base.where(Product.shop_id == shop_id)
        count_stmt = count_stmt.where(Product.shop_id == shop_id)
    if q:
        like = f"%{q.strip()}%"
        clause = or_(Product.name.ilike(like), Shop.name.ilike(like))
        base = base.where(clause)
        count_stmt = count_stmt.where(clause)

    stmt = base.order_by(Product.name).limit(limit).offset(offset)
    result = await db.execute(stmt)
    parent_rows = result.all()
    product_ids = [p.id for p, _ in parent_rows]

    items: list[ProductOut] = []
    if product_ids:
        variants_by_pid: dict[int, list[ProductVariant]] = {}
        v_result = await db.execute(
            select(ProductVariant)
            .where(ProductVariant.product_id.in_(product_ids))
            .order_by(ProductVariant.variant_index)
        )
        for v in v_result.scalars().all():
            variants_by_pid.setdefault(v.product_id, []).append(v)
        for product, shop_name in parent_rows:
            items.append(_hydrate_product_out(product, shop_name, variants_by_pid.get(product.id, [])))

    total_result = await db.execute(count_stmt)
    total = int(total_result.scalar() or 0)

    return AdminProductsPage(items=items, total=total, limit=limit, offset=offset)


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    product = await get_or_404(db, Product, product_id, detail="Product not found")
    await db.delete(product)
    await db.commit()


class ClearProductsResponse(BaseModel):
    deleted: int


@router.delete("/products", response_model=ClearProductsResponse)
async def clear_all_products(db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    total = int((await db.execute(select(func.count(Product.id)))).scalar() or 0)
    await db.execute(delete(ProductVariant))
    await db.execute(delete(Product))
    await db.commit()
    return ClearProductsResponse(deleted=total)


@router.post("/reindex-search", status_code=200)
async def reindex_search(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Backfill shop_name_cached and rebuild search_vector on all products.

    This should be run after deploying changes to the products_search_vector_update trigger.
    """
    from sqlalchemy import text

    async with db.begin():
        result = await db.execute(text("""
            UPDATE products p
            SET shop_name_cached = s.name
            FROM shops s
            WHERE s.id = p.shop_id
              AND (p.shop_name_cached IS DISTINCT FROM s.name)
        """))
        backfilled = result.rowcount

        result = await db.execute(text("UPDATE products SET name = name"))
        rebuilt = result.rowcount

    return {
        "status": "success",
        "shop_name_cached_backfilled": backfilled,
        "search_vector_rebuilt": rebuilt,
    }


@router.get("/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Return aggregate statistics about the inventory database."""
    from sqlalchemy import text as sa_text

    total_shops = int((await db.execute(select(func.count(Shop.id)))).scalar() or 0)
    total_products = int((await db.execute(select(func.count(Product.id)))).scalar() or 0)
    total_variants = int((await db.execute(select(func.count(ProductVariant.id)))).scalar() or 0)

    embedded_count = int(
        (await db.execute(
            select(func.count(Product.id)).where(Product.embedding.is_not(None))
        )).scalar() or 0
    )

    in_stock_count = int(
        (await db.execute(
            select(func.count(func.distinct(ProductVariant.product_id)))
            .where(ProductVariant.quantity > 0)
        )).scalar() or 0
    )

    # Products with website_url set (serves as "parent shops" proxy since shops
    # with a website_url were imported from external storefronts).
    shops_with_website = int(
        (await db.execute(
            select(func.count(Shop.id)).where(Shop.website_url.is_not(None))
        )).scalar() or 0
    )

    # Shops that have at least one product.
    shops_with_products = int(
        (await db.execute(
            select(func.count(func.distinct(Product.shop_id)))
        )).scalar() or 0
    )

    # Per-shop product counts for bar chart (top 15 by count).
    top_shops_result = await db.execute(
        select(Shop.name, func.count(Product.id).label("cnt"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id, Shop.name)
        .order_by(func.count(Product.id).desc())
        .limit(15)
    )
    top_shops = [{"name": row.name, "count": row.cnt} for row in top_shops_result.all()]

    # Variant option diversity — collect all distinct option_names.
    option_result = await db.execute(
        sa_text(
            "SELECT DISTINCT unnest(option_names) AS opt FROM product_variants "
            "WHERE option_names IS NOT NULL AND array_length(option_names, 1) > 0"
        )
    )
    distinct_option_types = [row[0] for row in option_result.all() if row[0]]

    # Price distribution buckets.
    price_result = await db.execute(
        select(ProductVariant.price).where(ProductVariant.price.is_not(None))
    )
    prices = [float(r[0]) for r in price_result.all() if r[0] is not None]
    price_buckets = {"under_25": 0, "25_to_50": 0, "50_to_100": 0, "over_100": 0}
    for p in prices:
        if p < 25:
            price_buckets["under_25"] += 1
        elif p < 50:
            price_buckets["25_to_50"] += 1
        elif p <= 100:
            price_buckets["50_to_100"] += 1
        else:
            price_buckets["over_100"] += 1

    return {
        "total_shops": total_shops,
        "total_products": total_products,
        "total_variants": total_variants,
        "shops_with_website": shops_with_website,
        "shops_with_products": shops_with_products,
        "embedded_count": embedded_count,
        "pct_embedded": round(embedded_count / total_products * 100, 1) if total_products else 0,
        "in_stock_count": in_stock_count,
        "pct_in_stock": round(in_stock_count / total_products * 100, 1) if total_products else 0,
        "top_shops": top_shops,
        "distinct_option_types": distinct_option_types,
        "price_buckets": price_buckets,
    }


@router.post("/create-vector-index", status_code=200)
async def create_vector_index(
    concurrently: bool = False,
    _: User = Depends(get_admin_user),
):
    """Create the HNSW index on products.embedding.

    This should be run once after deploying. The index build needs more
    shared memory than is available during normal app startup on Railway's
    managed Postgres.

    Use concurrently=true to avoid locking the products table during the build.
    """
    from sqlalchemy import text
    from db.database import engine

    stmt = (
        "CREATE INDEX {concurrently} IF NOT EXISTS ix_products_embedding_hnsw "
        "ON products USING hnsw (embedding vector_cosine_ops)"
    ).format(concurrently="CONCURRENTLY" if concurrently else "")

    # CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so we
    # use a raw engine connection (matching scripts/create_vector_index.py)
    # rather than the session-based get_db dependency.
    async with engine.connect() as conn:
        if concurrently:
            conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(text(stmt))
        if not concurrently:
            await conn.commit()

    return {
        "status": "success",
        "message": "HNSW index created or already exists",
        "concurrently": concurrently,
    }


