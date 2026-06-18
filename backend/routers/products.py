from fastapi import APIRouter, Depends, Query, HTTPException
from posthog import capture
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from typing import Optional
from decimal import Decimal
from db.database import get_db
from db.models import Product, ProductVariant, Shop
from db.schemas import ProductOut
from auth import get_current_user
from db.models import User
from routers.admin import _hydrate_product_out
from utils.parsing import parse_comma_int_list, parse_comma_str_list
from agent.tools import _search_products


router = APIRouter(prefix="/api/products", tags=["products"])


async def _hydrate_parents(rows: list[tuple[Product, str]], db: AsyncSession) -> list[ProductOut]:
    """Fetch variants for the parent ids in `rows`, preserving input order,
    and return ProductOut objects with variants/price_range/image_url filled."""
    if not rows:
        return []
    pids = [p.id for p, _ in rows]
    variants_by_pid: dict[int, list[ProductVariant]] = {}
    result = await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id.in_(pids))
        .order_by(ProductVariant.product_id, ProductVariant.variant_index)
    )
    for v in result.scalars().all():
        variants_by_pid.setdefault(v.product_id, []).append(v)
    return [
        _hydrate_product_out(product, shop_name, variants_by_pid.get(product.id, []))
        for product, shop_name in rows
    ]


def _count_filter_sql(
    stmt,
    shop_id,
    min_price,
    max_price,
    in_stock_only,
    shop_ids: list[int] | None = None,
    tags: list[str] | None = None,
):
    """Apply structural filters (shop/price/stock/tags) to a count query.
    Intentionally excludes full-text search — counting by text requires the
    full embedding pipeline and RRF which doesn't yield a simple total."""
    if shop_id is not None:
        stmt = stmt.where(Product.shop_id == shop_id)
    if shop_ids:
        stmt = stmt.where(Product.shop_id.in_(shop_ids))
    if min_price is not None or max_price is not None or in_stock_only:
        inner = select(ProductVariant.product_id).distinct()
        if min_price is not None:
            inner = inner.where(ProductVariant.price >= min_price)
        if max_price is not None:
            inner = inner.where(ProductVariant.price <= max_price)
        if in_stock_only:
            inner = inner.where(ProductVariant.quantity > 0)
        stmt = stmt.where(Product.id.in_(inner))
    if tags:
        stmt = stmt.where(
            text("(products.description->'tags') ?| :tag_arr").bindparams(tag_arr=tags)
        )
    return stmt


@router.get("/discover", response_model=list[ProductOut])
async def discover_products(
    q: Optional[str] = Query(default=None),
    shop_id: Optional[int] = Query(default=None),
    shop_ids: Optional[str] = Query(default=None, description="Comma-separated shop ids"),
    tags: Optional[str] = Query(default=None, description="Comma-separated tag names"),
    min_price: Optional[Decimal] = Query(default=None),
    max_price: Optional[Decimal] = Query(default=None),
    in_stock_only: bool = Query(default=False),
    limit: int = Query(default=20, le=50),
    offset: int = Query(default=0),
    seed: Optional[int] = Query(default=None, description="Random seed for browse order when no query"),
    db: AsyncSession = Depends(get_db),
):
    # When a seed is provided and there is no search query, use Postgres
    # setseed + random() so the browse order is stable within a session but
    # different across sessions.
    if seed is not None and not (q or "").strip():
        pg_seed = max(-1.0, min(1.0, (seed % 200001) / 100000 - 1.0))
        await db.execute(text("SELECT setseed(:s)"), {"s": pg_seed})

    result = await _search_products(
        {
            "query": q or "",
            "shop_id": shop_id,
            "shop_ids": parse_comma_int_list(shop_ids),
            "tags": parse_comma_str_list(tags),
            "min_price": float(min_price) if min_price is not None else None,
            "max_price": float(max_price) if max_price is not None else None,
            "in_stock_only": in_stock_only,
            "limit": limit,
            "seed": seed,
        },
        db,
    )
    # _search_products returns RRF-fused dicts; re-hydrate in that order so
    # the response uses the canonical ProductOut schema the frontend expects.
    ordered_ids = [p["product_id"] for p in result.get("products", [])]
    if not ordered_ids:
        if q:
            capture("product_searched", properties={
                "result_count": 0,
                "has_shop_filter": shop_id is not None or bool(shop_ids),
                "has_price_filter": min_price is not None or max_price is not None,
                "in_stock_only": in_stock_only,
            })
        return []

    rows_result = await db.execute(
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .where(Product.id.in_(ordered_ids))
    )
    by_id = {p.id: (p, sn) for p, sn in rows_result.all()}
    ordered_rows = [by_id[pid] for pid in ordered_ids if pid in by_id]
    hydrated = await _hydrate_parents(ordered_rows, db)

    if q:
        capture("product_searched", properties={
            "result_count": len(hydrated),
            "has_shop_filter": shop_id is not None or bool(shop_ids),
            "has_price_filter": min_price is not None or max_price is not None,
            "in_stock_only": in_stock_only,
        })
    return hydrated


@router.get("/similar", response_model=list[ProductOut])
async def similar_products(
    product_id: int = Query(..., description="Source product id"),
    limit: int = Query(default=15, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """Return up to `limit` products most similar to `product_id` by vector cosine distance."""
    from sqlalchemy import text as sa_text
    from db.models import ProductVariant

    # Fetch the source product's embedding.
    emb_result = await db.execute(
        select(Product.embedding).where(Product.id == product_id)
    )
    row = emb_result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if row is None or (hasattr(row, '__len__') and len(row) == 0):
        return []

    # Vector similarity search excluding the source product.
    sim_result = await db.execute(
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .where(Product.id != product_id)
        .where(Product.embedding.isnot(None))
        .order_by(Product.embedding.op("<->")(row))
        .limit(limit)
    )
    rows = sim_result.all()
    return await _hydrate_parents(rows, db)


@router.get("/discover/count")
async def discover_count(
    q: Optional[str] = Query(default=None),
    shop_id: Optional[int] = Query(default=None),
    shop_ids: Optional[str] = Query(default=None),
    tags: Optional[str] = Query(default=None),
    min_price: Optional[Decimal] = Query(default=None),
    max_price: Optional[Decimal] = Query(default=None),
    in_stock_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(func.count(Product.id)).join(Shop, Shop.id == Product.shop_id)
    stmt = _count_filter_sql(
        stmt,
        shop_id,
        min_price,
        max_price,
        in_stock_only,
        shop_ids=parse_comma_int_list(shop_ids),
        tags=parse_comma_str_list(tags),
    )
    result = await db.execute(stmt)
    total = result.scalar() or 0
    return {"total": int(total)}


@router.get("/tags")
async def list_tags(
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text(
            "SELECT DISTINCT jsonb_array_elements_text(description->'tags') AS tag "
            "FROM products WHERE description ? 'tags' ORDER BY tag LIMIT :limit"
        ),
        {"limit": limit},
    )
    return [row.tag for row in result.all() if row.tag]


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(product_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .where(Product.id == product_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    product, shop_name = row
    variants = (await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id == product_id)
        .order_by(ProductVariant.variant_index)
    )).scalars().all()
    capture(
        "product_viewed",
        properties={
            "product_id": product_id,
            "shop_id": product.shop_id,
            "variant_count": len(variants),
        },
    )
    return _hydrate_product_out(product, shop_name, list(variants))
