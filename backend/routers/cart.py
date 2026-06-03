"""Cart REST endpoints + the underlying dict-returning operations.

The agent tool dispatcher imports the bare functions (view, add_item, etc.)
and expects them to return dicts — that's why we keep dict returns and only
translate to HTTPException at the route boundary.
"""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from db.database import get_db
from db.models import CartItem, Product, Shop, User

router = APIRouter(prefix="/api/cart", tags=["cart"])


# ── Core operations (also called from the agent tool dispatcher) ─────────────

def _owner_filter(user_id: int | None, session_id: int | None):
    if user_id is not None:
        return CartItem.user_id == user_id
    return and_(CartItem.session_id == session_id, CartItem.user_id.is_(None))


async def view(user_id: int | None, session_id: int | None, db: AsyncSession) -> dict:
    stmt = (
        select(CartItem, Product, Shop.name.label("shop_name"))
        .join(Product, Product.id == CartItem.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(_owner_filter(user_id, session_id))
        .order_by(CartItem.created_at)
    )
    rows = (await db.execute(stmt)).all()
    items = []
    total = 0.0
    for cart_item, product, shop_name in rows:
        subtotal = float(product.price) * cart_item.quantity
        total += subtotal
        items.append({
            "product_id": product.id,
            "name": product.name,
            "shop_name": shop_name,
            "image_url": product.image_url,
            "price": float(product.price),
            "quantity": cart_item.quantity,
            "subtotal": round(subtotal, 2),
        })
    return {"items": items, "item_count": len(items), "total": round(total, 2)}


async def add_item(
    product_id: int,
    quantity: int,
    user_id: int | None,
    session_id: int | None,
    db: AsyncSession,
) -> dict:
    if quantity < 1:
        return {"added": False, "reason": "quantity_must_be_positive"}

    product = (await db.execute(select(Product).where(Product.id == product_id))).scalars().first()
    if product is None:
        return {"added": False, "reason": "product_not_found", "product_id": product_id}

    existing = (
        await db.execute(
            select(CartItem).where(
                _owner_filter(user_id, session_id), CartItem.product_id == product_id
            )
        )
    ).scalars().first()

    current_qty = existing.quantity if existing else 0
    new_qty = current_qty + quantity
    if new_qty > product.quantity:
        return {
            "added": False,
            "reason": "insufficient_stock",
            "product_id": product_id,
            "product_name": product.name,
            "requested_quantity": new_qty,
            "available": product.quantity,
            "in_cart": current_qty,
        }

    if existing:
        existing.quantity = new_qty
    else:
        db.add(CartItem(
            user_id=user_id,
            session_id=None if user_id is not None else session_id,
            product_id=product_id,
            quantity=quantity,
        ))

    await db.flush()
    return {
        "added": True,
        "product_id": product_id,
        "product_name": product.name,
        "new_quantity": new_qty,
        "unit_price": float(product.price),
        "line_subtotal": round(float(product.price) * new_qty, 2),
    }


async def set_quantity(
    product_id: int,
    quantity: int,
    user_id: int | None,
    session_id: int | None,
    db: AsyncSession,
) -> dict:
    existing = (
        await db.execute(
            select(CartItem).where(
                _owner_filter(user_id, session_id), CartItem.product_id == product_id
            )
        )
    ).scalars().first()
    if existing is None:
        return {"updated": False, "reason": "not_in_cart", "product_id": product_id}

    if quantity < 1:
        await db.delete(existing)
        await db.flush()
        return {"updated": True, "removed": True, "product_id": product_id}

    product = (await db.execute(select(Product).where(Product.id == product_id))).scalars().first()
    if product is None:
        return {"updated": False, "reason": "product_not_found", "product_id": product_id}
    if quantity > product.quantity:
        return {
            "updated": False,
            "reason": "insufficient_stock",
            "product_id": product_id,
            "product_name": product.name,
            "requested_quantity": quantity,
            "available": product.quantity,
        }

    existing.quantity = quantity
    await db.flush()
    return {"updated": True, "product_id": product_id, "quantity": quantity}


async def remove_item(
    product_id: int,
    user_id: int | None,
    session_id: int | None,
    db: AsyncSession,
) -> dict:
    result = await db.execute(
        delete(CartItem).where(
            _owner_filter(user_id, session_id), CartItem.product_id == product_id
        )
    )
    await db.flush()
    return {"removed": (result.rowcount or 0) > 0, "product_id": product_id}


async def checkout(user_id: int | None, session_id: int | None, db: AsyncSession) -> dict:
    cart = await view(user_id, session_id, db)
    if cart["item_count"] == 0:
        return {"checkout_url": None, "items_count": 0, "total": 0.0, "reason": "cart_empty"}

    checkout_url = f"https://checkout.example.com/c/{uuid4()}"
    await db.execute(delete(CartItem).where(_owner_filter(user_id, session_id)))
    await db.flush()
    return {
        "checkout_url": checkout_url,
        "items_count": cart["item_count"],
        "total": cart["total"],
    }


# ── HTTP endpoints ───────────────────────────────────────────────────────────

class AddItemIn(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1)


class SetQuantityIn(BaseModel):
    quantity: int = Field(ge=0)


def _raise_for_reason(result: dict) -> None:
    reason = result.get("reason")
    if reason == "insufficient_stock":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    f"Only {result['available']} of \"{result['product_name']}\" in stock"
                    + (f" (you have {result['in_cart']} in your cart)" if "in_cart" in result else "")
                    + "."
                ),
                **result,
            },
        )
    if reason == "product_not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")


@router.get("")
async def get_cart(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await view(user_id=user.id, session_id=None, db=db)


@router.post("/items")
async def http_add_item(
    body: AddItemIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await add_item(
        product_id=body.product_id,
        quantity=body.quantity,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    _raise_for_reason(result)
    await db.commit()
    cart = await view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.patch("/items/{product_id}")
async def http_set_item_quantity(
    product_id: int,
    body: SetQuantityIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await set_quantity(
        product_id=product_id,
        quantity=body.quantity,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    _raise_for_reason(result)
    await db.commit()
    cart = await view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.delete("/items/{product_id}")
async def http_remove_item(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await remove_item(
        product_id=product_id,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    await db.commit()
    cart = await view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.post("/checkout")
async def http_checkout(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await checkout(user_id=user.id, session_id=None, db=db)
    await db.commit()
    return result
