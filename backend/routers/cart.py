"""Cart REST endpoints + the underlying dict-returning operations.

The agent tool dispatcher imports the bare functions (view, add_item, etc.)
and expects them to return dicts — that's why we keep dict returns and only
translate to HTTPException at the route boundary.
"""
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import settings
from db.database import get_db
from db.models import CartItem, Product, ProductVariant, Shop, User

router = APIRouter(prefix="/api/cart", tags=["cart"])

if settings.stripe_secret_key:
    stripe.api_key = settings.stripe_secret_key


def _stripe_success_url() -> str:
    base = settings.stripe_success_url or f"{settings.frontend_url.split(',')[0].strip()}/cart/success"
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}session_id={{CHECKOUT_SESSION_ID}}"


def _stripe_cancel_url() -> str:
    return settings.stripe_cancel_url or f"{settings.frontend_url.split(',')[0].strip()}/cart"


# ── Core operations (also called from the agent tool dispatcher) ─────────────

def _owner_filter(user_id: int | None, session_id: int | None):
    if user_id is not None:
        return CartItem.user_id == user_id
    return and_(CartItem.session_id == session_id, CartItem.user_id.is_(None))


async def view(user_id: int | None, session_id: int | None, db: AsyncSession) -> dict:
    stmt = (
        select(CartItem, ProductVariant, Product, Shop.name.label("shop_name"))
        .join(ProductVariant, ProductVariant.id == CartItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(_owner_filter(user_id, session_id))
        .order_by(CartItem.created_at)
    )
    rows = (await db.execute(stmt)).all()
    items = []
    total = 0.0
    for cart_item, variant, product, shop_name in rows:
        unit_price = float(variant.price or 0)
        subtotal = unit_price * cart_item.quantity
        total += subtotal
        items.append({
            "variant_id": variant.id,
            "product_id": product.id,
            "name": product.name,
            "variant_label": variant.variant_label,
            "option_names": list(variant.option_names or []),
            "option_values": list(variant.option_values or []),
            "parent_store": None,
            "shop_name": shop_name,
            "image_url": variant.image_url,
            "price": unit_price,
            "quantity": cart_item.quantity,
            "subtotal": round(subtotal, 2),
        })
    return {"items": items, "item_count": len(items), "total": round(total, 2)}


async def _resolve_variant_id(
    variant_id: int | None,
    product_id: int | None,
    db: AsyncSession,
) -> int | None:
    """Accept either a variant_id or a product_id; if only a product_id is
    given, return the parent's default variant. Returns None if nothing
    resolvable was supplied."""
    if variant_id is not None:
        return int(variant_id)
    if product_id is None:
        return None
    product = (await db.execute(
        select(Product).where(Product.id == int(product_id))
    )).scalars().first()
    if product is None:
        return None
    if product.default_variant_id is not None:
        return product.default_variant_id
    # Fall back to the lowest-index variant.
    v = (await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id == product.id)
        .order_by(ProductVariant.variant_index)
        .limit(1)
    )).scalars().first()
    return v.id if v else None


async def add_item(
    variant_id: int | None = None,
    quantity: int = 1,
    user_id: int | None = None,
    session_id: int | None = None,
    db: AsyncSession = None,
    *,
    product_id: int | None = None,
) -> dict:
    if quantity < 1:
        return {"added": False, "reason": "quantity_must_be_positive"}

    resolved_vid = await _resolve_variant_id(variant_id, product_id, db)
    if resolved_vid is None:
        return {"added": False, "reason": "variant_not_found", "variant_id": variant_id, "product_id": product_id}

    variant = (await db.execute(
        select(ProductVariant, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductVariant.id == resolved_vid)
    )).first()
    if variant is None:
        return {"added": False, "reason": "variant_not_found", "variant_id": resolved_vid}
    variant_row, product = variant

    existing = (
        await db.execute(
            select(CartItem).where(
                _owner_filter(user_id, session_id), CartItem.variant_id == resolved_vid
            )
        )
    ).scalars().first()

    current_qty = existing.quantity if existing else 0
    new_qty = current_qty + quantity
    if new_qty > (variant_row.quantity or 0):
        return {
            "added": False,
            "reason": "insufficient_stock",
            "variant_id": resolved_vid,
            "product_id": product.id,
            "product_name": product.name,
            "variant_label": variant_row.variant_label,
            "requested_quantity": new_qty,
            "available": variant_row.quantity or 0,
            "in_cart": current_qty,
        }

    if existing:
        existing.quantity = new_qty
    else:
        db.add(CartItem(
            user_id=user_id,
            session_id=None if user_id is not None else session_id,
            variant_id=resolved_vid,
            quantity=quantity,
        ))

    await db.flush()
    unit_price = float(variant_row.price or 0)
    return {
        "added": True,
        "variant_id": resolved_vid,
        "product_id": product.id,
        "product_name": product.name,
        "variant_label": variant_row.variant_label,
        "new_quantity": new_qty,
        "unit_price": unit_price,
        "line_subtotal": round(unit_price * new_qty, 2),
    }


async def set_quantity(
    variant_id: int,
    quantity: int,
    user_id: int | None,
    session_id: int | None,
    db: AsyncSession,
) -> dict:
    existing = (
        await db.execute(
            select(CartItem).where(
                _owner_filter(user_id, session_id), CartItem.variant_id == variant_id
            )
        )
    ).scalars().first()
    if existing is None:
        return {"updated": False, "reason": "not_in_cart", "variant_id": variant_id}

    if quantity < 1:
        await db.delete(existing)
        await db.flush()
        return {"updated": True, "removed": True, "variant_id": variant_id}

    variant = (await db.execute(
        select(ProductVariant, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductVariant.id == variant_id)
    )).first()
    if variant is None:
        return {"updated": False, "reason": "variant_not_found", "variant_id": variant_id}
    variant_row, product = variant
    if quantity > (variant_row.quantity or 0):
        return {
            "updated": False,
            "reason": "insufficient_stock",
            "variant_id": variant_id,
            "product_id": product.id,
            "product_name": product.name,
            "variant_label": variant_row.variant_label,
            "requested_quantity": quantity,
            "available": variant_row.quantity or 0,
        }

    existing.quantity = quantity
    await db.flush()
    return {"updated": True, "variant_id": variant_id, "quantity": quantity}


async def remove_item(
    variant_id: int,
    user_id: int | None,
    session_id: int | None,
    db: AsyncSession,
) -> dict:
    result = await db.execute(
        delete(CartItem).where(
            _owner_filter(user_id, session_id), CartItem.variant_id == variant_id
        )
    )
    await db.flush()
    return {"removed": (result.rowcount or 0) > 0, "variant_id": variant_id}


async def checkout(user_id: int | None, session_id: int | None, db: AsyncSession) -> dict:
    cart = await view(user_id, session_id, db)
    if cart["item_count"] == 0:
        return {"checkout_url": None, "items_count": 0, "total": 0.0, "reason": "cart_empty"}

    if not settings.stripe_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe is not configured on the server.",
        )

    line_items = []
    for it in cart["items"]:
        product_data: dict = {"name": it["name"]}
        if it.get("image_url"):
            product_data["images"] = [it["image_url"]]
        line_items.append({
            "price_data": {
                "currency": "usd",
                "unit_amount": int(round(float(it["price"]) * 100)),
                "product_data": product_data,
            },
            "quantity": int(it["quantity"]),
        })

    try:
        stripe_session = stripe.checkout.Session.create(
            mode="payment",
            line_items=line_items,
            success_url=_stripe_success_url(),
            cancel_url=_stripe_cancel_url(),
            client_reference_id=str(user_id) if user_id is not None else None,
            metadata={"user_id": str(user_id) if user_id is not None else ""},
        )
    except stripe.error.StripeError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe error: {e.user_message or str(e)}",
        )

    return {
        "checkout_url": stripe_session.url,
        "session_id": stripe_session.id,
        "items_count": cart["item_count"],
        "total": cart["total"],
    }


# ── HTTP endpoints ───────────────────────────────────────────────────────────

class AddItemIn(BaseModel):
    variant_id: int | None = None
    product_id: int | None = None  # accepted as a shortcut: resolves to default variant
    quantity: int = Field(default=1, ge=1)


class SetQuantityIn(BaseModel):
    quantity: int = Field(ge=0)


def _raise_for_reason(result: dict) -> None:
    reason = result.get("reason")
    if reason == "insufficient_stock":
        label = result.get("variant_label") or result.get("product_name") or "item"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    f"Only {result['available']} of \"{label}\" in stock"
                    + (f" (you have {result['in_cart']} in your cart)" if "in_cart" in result else "")
                    + "."
                ),
                **result,
            },
        )
    if reason in {"variant_not_found", "product_not_found"}:
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
    if body.variant_id is None and body.product_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="variant_id or product_id required",
        )
    result = await add_item(
        variant_id=body.variant_id,
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


@router.patch("/items/{variant_id}")
async def http_set_item_quantity(
    variant_id: int,
    body: SetQuantityIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await set_quantity(
        variant_id=variant_id,
        quantity=body.quantity,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    _raise_for_reason(result)
    await db.commit()
    cart = await view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.delete("/items/{variant_id}")
async def http_remove_item(
    variant_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await remove_item(
        variant_id=variant_id,
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


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe webhook secret is not configured.",
        )
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid webhook: {e}")

    if event["type"] == "checkout.session.completed":
        stripe_session = event["data"]["object"]
        ref = stripe_session.get("client_reference_id")
        if ref:
            try:
                user_id = int(ref)
            except ValueError:
                user_id = None
            if user_id is not None:
                await db.execute(delete(CartItem).where(_owner_filter(user_id, None)))
                await db.commit()

    return {"received": True}
