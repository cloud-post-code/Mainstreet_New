"""Cart business logic shared by the REST router and the agent tools."""
from uuid import uuid4

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import CartItem, Product, Shop


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

    if existing:
        existing.quantity = existing.quantity + quantity
        new_qty = existing.quantity
    else:
        item = CartItem(
            user_id=user_id,
            session_id=None if user_id is not None else session_id,
            product_id=product_id,
            quantity=quantity,
        )
        db.add(item)
        new_qty = quantity

    await db.flush()
    warning = None
    if new_qty > product.quantity:
        warning = f"Requested {new_qty} but only {product.quantity} in stock."

    return {
        "added": True,
        "product_id": product_id,
        "product_name": product.name,
        "new_quantity": new_qty,
        "unit_price": float(product.price),
        "line_subtotal": round(float(product.price) * new_qty, 2),
        "warning": warning,
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
