from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, or_
from sqlalchemy.dialects.postgresql import TSVECTOR
from typing import Optional
from decimal import Decimal
from db.database import get_db
from db.models import Product, Shop
from db.schemas import ProductOut
from auth import get_current_user
from db.models import User


router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=list[ProductOut])
async def search_products(
    q: Optional[str] = Query(default=None),
    shop_id: Optional[int] = Query(default=None),
    min_price: Optional[Decimal] = Query(default=None),
    max_price: Optional[Decimal] = Query(default=None),
    in_stock_only: bool = Query(default=False),
    limit: int = Query(default=20, le=50),
    offset: int = Query(default=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
    )

    if q:
        ts_query = func.plainto_tsquery("english", q)
        stmt = stmt.where(Product.search_vector.op("@@")(ts_query))
        stmt = stmt.order_by(func.ts_rank(Product.search_vector, ts_query).desc())
    else:
        stmt = stmt.order_by(Product.name)

    if shop_id is not None:
        stmt = stmt.where(Product.shop_id == shop_id)
    if min_price is not None:
        stmt = stmt.where(Product.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Product.price <= max_price)
    if in_stock_only:
        stmt = stmt.where(Product.quantity > 0)

    stmt = stmt.limit(limit).offset(offset)

    result = await db.execute(stmt)
    rows = result.all()
    products = []
    for product, shop_name in rows:
        out = ProductOut.model_validate(product)
        out.shop_name = shop_name
        products.append(out)
    return products


def _apply_product_filters(
    stmt,
    q,
    shop_id,
    min_price,
    max_price,
    in_stock_only,
    shop_ids: list[int] | None = None,
    tags: list[str] | None = None,
):
    if q:
        ts_query = func.websearch_to_tsquery("english", q)
        # Tsvector covers product name, cached shop name, summary, tags,
        # long, materials, variant, made_in. Trigram on name catches typos
        # and partial matches that stem to nothing useful.
        stmt = stmt.where(
            or_(
                Product.search_vector.op("@@")(ts_query),
                Product.name.op("%")(q),
            )
        )
    if shop_id is not None:
        stmt = stmt.where(Product.shop_id == shop_id)
    if shop_ids:
        stmt = stmt.where(Product.shop_id.in_(shop_ids))
    if min_price is not None:
        stmt = stmt.where(Product.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Product.price <= max_price)
    if in_stock_only:
        stmt = stmt.where(Product.quantity > 0)
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
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
    )
    stmt = _apply_product_filters(
        stmt,
        q,
        shop_id,
        min_price,
        max_price,
        in_stock_only,
        shop_ids=[int(t) for t in (shop_ids or "").split(",") if t.strip().isdigit()],
        tags=[t.strip() for t in (tags or "").split(",") if t.strip()],
    )
    if q:
        ts_query = func.websearch_to_tsquery("english", q)
        stmt = stmt.order_by(
            func.ts_rank(Product.search_vector, ts_query).desc(),
            func.similarity(Product.name, q).desc(),
        )
    else:
        stmt = stmt.order_by(Product.id)
    stmt = stmt.limit(limit).offset(offset)

    result = await db.execute(stmt)
    rows = result.all()
    products = []
    for product, shop_name in rows:
        out = ProductOut.model_validate(product)
        out.shop_name = shop_name
        products.append(out)
    return products


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
    stmt = _apply_product_filters(
        stmt,
        q,
        shop_id,
        min_price,
        max_price,
        in_stock_only,
        shop_ids=[int(t) for t in (shop_ids or "").split(",") if t.strip().isdigit()],
        tags=[t.strip() for t in (tags or "").split(",") if t.strip()],
    )
    result = await db.execute(stmt)
    total = result.scalar() or 0
    return {"total": int(total)}


@router.get("/tags")
async def list_tags(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            "SELECT DISTINCT jsonb_array_elements_text(description->'tags') AS tag "
            "FROM products WHERE description ? 'tags' ORDER BY tag"
        )
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
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Product not found")
    product, shop_name = row
    out = ProductOut.model_validate(product)
    out.shop_name = shop_name
    return out
