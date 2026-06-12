from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from db.database import get_db
from db.models import Shop, Product
from db.schemas import ShopOut
from auth import get_current_user
from db.models import User

router = APIRouter(prefix="/api/shops", tags=["shops"])


@router.get("/public")
async def list_shops_public(
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Lightweight unauthenticated list of shops for filter UIs."""
    result = await db.execute(
        select(Shop.id, Shop.name).order_by(Shop.name).limit(limit).offset(offset)
    )
    return [{"id": row.id, "name": row.name} for row in result.all()]


@router.get("/public/full")
async def list_shops_public_full(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Unauthenticated list of shops with details + product counts for the
    public Discover "Shop by shop" view."""
    stmt = (
        select(
            Shop.id,
            Shop.name,
            Shop.logo_url,
            Shop.description,
            Shop.website_url,
            func.count(Product.id).label("product_count"),
        )
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    return [
        {
            "id": row.id,
            "name": row.name,
            "logo_url": row.logo_url,
            "description": row.description,
            "website_url": row.website_url,
            "product_count": row.product_count,
        }
        for row in result.all()
    ]


@router.get("", response_model=list[ShopOut])
async def list_shops(
    q: str = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(
            Shop,
            func.count(Product.id).label("product_count"),
        )
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
        .limit(limit)
        .offset(offset)
    )
    if q:
        stmt = stmt.where(Shop.name.ilike(f"%{q}%") | Shop.description.ilike(f"%{q}%"))

    result = await db.execute(stmt)
    rows = result.all()
    shops = []
    for shop, count in rows:
        out = ShopOut.model_validate(shop)
        out.product_count = count
        shops.append(out)
    return shops


@router.get("/{shop_id}", response_model=ShopOut)
async def get_shop(shop_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(Shop, func.count(Product.id).label("product_count"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .where(Shop.id == shop_id)
        .group_by(Shop.id)
    )
    row = result.first()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Shop not found")
    shop, count = row
    out = ShopOut.model_validate(shop)
    out.product_count = count
    return out
