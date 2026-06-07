"""Cart-specific DB lookups shared by the REST endpoints and the agent
tool dispatcher."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import CartItem, Product, ProductVariant


async def get_variant_with_product(
    db: AsyncSession, variant_id: int
) -> tuple[ProductVariant, Product] | None:
    """Return (variant, parent product) for the given variant_id, or None."""
    row = (
        await db.execute(
            select(ProductVariant, Product)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(ProductVariant.id == variant_id)
        )
    ).first()
    if row is None:
        return None
    variant, product = row
    return variant, product


async def get_cart_item(
    db: AsyncSession,
    variant_id: int,
    owner_filter,
) -> CartItem | None:
    """Fetch the cart row for this variant under the given owner filter."""
    return (
        await db.execute(
            select(CartItem).where(owner_filter, CartItem.variant_id == variant_id)
        )
    ).scalars().first()
