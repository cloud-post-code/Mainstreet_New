"""
Shared upsert helpers used by both the CSV importer and the scraper ingestor.

Both ``upsert_shop`` and ``upsert_product_group`` are thin wrappers around the
same SQL patterns that live in routers/admin.py so that two code paths can share
the logic without duplicating it.

Callers are responsible for calling ``await db.commit()`` after all groups have
been processed.  These helpers only ``flush`` (so they can get auto-assigned
primary keys inside the same transaction).
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Product, ProductVariant, Shop


def _split_options(raw: str) -> list[str]:
    """Split a slash-joined option string into individual labels."""
    if not raw:
        return []
    return [p.strip() for p in raw.split("/") if p.strip()]


def _parse_variant_index(row: dict) -> int:
    try:
        return int((row.get("variant_index") or "1").strip() or 1)
    except (ValueError, AttributeError):
        return 1


async def upsert_shop(
    db: AsyncSession,
    name: str,
    logo_url: Optional[str] = None,
    description: Optional[str] = None,
    website_url: Optional[str] = None,
) -> tuple[Shop, bool]:
    """Upsert a Shop by name.

    Returns ``(shop, created)`` where *created* is ``True`` when a new row was
    inserted and ``False`` when an existing row was found (and optionally updated).

    The caller must ``flush`` or ``commit`` the session at some point after this
    call for the INSERT to materialise in the database.
    """
    result = await db.execute(select(Shop).where(Shop.name == name))
    shop: Optional[Shop] = result.scalars().first()

    if shop is not None:
        # Apply updates only when the new value is not None so that callers that
        # omit optional fields don't accidentally blank an existing value.
        if logo_url is not None:
            shop.logo_url = logo_url
        if description is not None:
            shop.description = description
        if website_url is not None:
            shop.website_url = website_url
        return shop, False

    shop = Shop(
        name=name,
        logo_url=logo_url,
        description=description,
        website_url=website_url,
    )
    db.add(shop)
    await db.flush()  # populate shop.id so variants can reference it
    return shop, True


async def upsert_product_group(
    db: AsyncSession,
    shop: Shop,
    handle: str,
    rows: list[dict],
) -> tuple[Product, list[ProductVariant], bool]:
    """Upsert a parent Product plus all its ProductVariants from a list of row dicts.

    *rows* uses the same field names as the CSV import (shop_name, product_handle,
    base_product_name, product_name, variant_id, variant_index, option_names,
    option_values, price, quantity, image_url, description_json, parent_store).

    Returns ``(product, variants, created)`` where *created* is ``True`` when the
    parent product row was newly inserted.

    Raises ``ValueError`` for missing required fields so callers can log per-group
    errors without aborting the whole import.
    """
    if not rows:
        raise ValueError("upsert_product_group called with empty rows list")

    # Sort so variant_index=1 is processed first and becomes the default.
    rows_sorted = sorted(rows, key=_parse_variant_index)
    first_row = rows_sorted[0]

    base_name = (
        (first_row.get("base_product_name") or "").strip()
        or (first_row.get("product_name") or "").strip()
    )
    if not base_name:
        raise ValueError("base_product_name and product_name are both empty")

    # Parse parent description from the first row.
    parent_description: Optional[dict] = None
    raw_desc = (first_row.get("description_json") or "").strip()
    if raw_desc:
        try:
            parsed = json.loads(raw_desc)
            parent_description = parsed if isinstance(parsed, dict) else {"summary": raw_desc}
        except json.JSONDecodeError:
            parent_description = {"summary": raw_desc}

    # Upsert parent product keyed on (shop_id, handle).
    existing_result = await db.execute(
        select(Product).where(
            Product.shop_id == shop.id,
            Product.handle == handle,
        )
    )
    existing: Optional[Product] = existing_result.scalars().first()
    created = False

    if existing is not None:
        existing.name = base_name
        existing.description = parent_description
        existing.shop_name_cached = shop.name
        product = existing
    else:
        product = Product(
            shop_id=shop.id,
            handle=handle,
            name=base_name,
            description=parent_description,
            shop_name_cached=shop.name,
        )
        db.add(product)
        await db.flush()  # populate product.id
        created = True

    # Upsert variants.
    upserted_variants: list[ProductVariant] = []
    seen_variant_ids: set[int] = set()
    first_variant_id: Optional[int] = None

    for row in rows_sorted:
        raw_external = (row.get("variant_id") or "").strip()
        external_id: Optional[int]
        try:
            external_id = int(raw_external) if raw_external else None
        except ValueError:
            external_id = None

        variant_label = (row.get("product_name") or base_name).strip()
        option_names = _split_options(row.get("option_names") or "")
        option_values = _split_options(row.get("option_values") or "")

        try:
            price = Decimal((row.get("price") or "0").strip() or "0")
        except InvalidOperation:
            raise ValueError(f"Invalid price: {row.get('price')!r}")

        try:
            quantity = int((row.get("quantity") or "0").strip() or "0")
        except ValueError:
            raise ValueError(f"Invalid quantity: {row.get('quantity')!r}")

        image_url: Optional[str] = (row.get("image_url") or "").strip() or None
        variant_index = _parse_variant_index(row)

        variant_description: Optional[dict] = None
        raw_v_desc = (row.get("description_json") or "").strip()
        if raw_v_desc:
            try:
                parsed_v = json.loads(raw_v_desc)
                variant_description = parsed_v if isinstance(parsed_v, dict) else {"summary": raw_v_desc}
            except json.JSONDecodeError:
                variant_description = {"summary": raw_v_desc}

        # Look up existing variant by external_variant_id (if present).
        variant: Optional[ProductVariant] = None
        if external_id is not None:
            v_result = await db.execute(
                select(ProductVariant).where(
                    ProductVariant.product_id == product.id,
                    ProductVariant.external_variant_id == external_id,
                )
            )
            variant = v_result.scalars().first()

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

        upserted_variants.append(variant)

    # Point the parent at its default variant.
    if product.default_variant_id not in seen_variant_ids:
        product.default_variant_id = first_variant_id

    return product, upserted_variants, created
