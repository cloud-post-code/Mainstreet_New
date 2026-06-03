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
from db.models import Shop, Product, User
from db.schemas import ImportResult, ShopOut, ShopCreate, ProductOut, AdminProductsPage
from auth import get_admin_user

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_CSV_BYTES = 10 * 1024 * 1024

router = APIRouter(prefix="/api/admin", tags=["admin"])

EXPECTED_COLUMNS = {"shop_name", "product_name", "price", "quantity", "image_url", "description_json"}
SHOP_EXPECTED_COLUMNS = {"name"}


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

    shop_cache: dict[str, Shop] = {}

    for i, row in enumerate(reader, start=2):  # row 1 = header
        try:
            shop_name = row["shop_name"].strip()
            if not shop_name:
                raise ValueError("shop_name is empty")

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

            product_name = row["product_name"].strip()
            if not product_name:
                raise ValueError("product_name is empty")

            try:
                price = Decimal(row["price"].strip())
            except InvalidOperation:
                raise ValueError(f"Invalid price: {row['price']}")

            try:
                quantity = int(row["quantity"].strip() or "0")
            except ValueError:
                raise ValueError(f"Invalid quantity: {row['quantity']}")

            image_url = row["image_url"].strip() or None

            description = None
            raw_desc = row["description_json"].strip()
            if raw_desc:
                try:
                    description = json.loads(raw_desc)
                except json.JSONDecodeError:
                    description = {"summary": raw_desc}

            # Check if product exists (match by shop + name)
            result = await db.execute(
                select(Product).where(Product.shop_id == shop.id, Product.name == product_name)
            )
            existing = result.scalars().first()
            if existing:
                existing.price = price
                existing.quantity = quantity
                existing.image_url = image_url
                existing.description = description
                rows_updated += 1
            else:
                db.add(Product(
                    shop_id=shop.id,
                    name=product_name,
                    price=price,
                    quantity=quantity,
                    image_url=image_url,
                    description=description,
                ))
                rows_added += 1

        except Exception as e:
            errors.append({"row": i, "error": str(e)})

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


def _csv_safe(value) -> str:
    """Defuse CSV-formula injection. Excel/Sheets execute cells starting with
    =, +, -, @, tab, or CR as formulas. Prefix with a single quote when needed."""
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def _csv_response(content: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/products")
async def export_products_csv(
    shop_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    stmt = (
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .order_by(Shop.name, Product.name)
    )
    if shop_id:
        stmt = stmt.where(Product.shop_id == shop_id)

    result = await db.execute(stmt)
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["shop_name", "product_name", "price", "quantity", "image_url", "description_json"],
    )
    writer.writeheader()
    for product, shop_name in result.all():
        description_json = ""
        if product.description is not None:
            description_json = json.dumps(product.description, ensure_ascii=False)
        writer.writerow(
            {
                "shop_name": _csv_safe(shop_name),
                "product_name": _csv_safe(product.name),
                "price": str(product.price),
                "quantity": product.quantity,
                "image_url": _csv_safe(product.image_url or ""),
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
async def admin_list_shops(db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    from sqlalchemy import func
    result = await db.execute(
        select(Shop, func.count(Product.id).label("product_count"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
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
    result = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = result.scalars().first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
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
    items: list[ProductOut] = []
    for product, shop_name in result.all():
        out = ProductOut.model_validate(product)
        out.shop_name = shop_name
        items.append(out)

    total_result = await db.execute(count_stmt)
    total = int(total_result.scalar() or 0)

    return AdminProductsPage(items=items, total=total, limit=limit, offset=offset)


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_admin_user)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.delete(product)
    await db.commit()


