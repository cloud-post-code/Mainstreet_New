"""One-time migration: collapse the flat `products` table into parent products
plus per-variant `product_variants`, then remap any existing cart rows.

This script is idempotent for products it has already migrated — re-runs only
touch rows that don't yet have a corresponding variant.

Usage (from backend/):
    python -m scripts.migrate_to_variants --dry-run
    python -m scripts.migrate_to_variants
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import re
import sys
from collections import defaultdict
from decimal import Decimal
from typing import Iterable

# Allow running as `python scripts/migrate_to_variants.py` from the backend dir.
sys.path.insert(0, "backend")

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import AsyncSessionLocal, engine, create_tables
from db.models import CartItem, Product, ProductVariant, Shop

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("migrate_to_variants")


_SUFFIX_RE = re.compile(r"\s*-\s*(?P<suffix>[^-]+)$")


def _base_name(name: str, description: dict | None) -> str:
    """Strip the trailing ' - Variant' suffix from product_name to get the
    parent name. Prefer description['base_product_name'] when present."""
    if description and isinstance(description.get("base_product_name"), str):
        return description["base_product_name"].strip()
    m = _SUFFIX_RE.search(name or "")
    if not m:
        return (name or "").strip()
    return (name[: m.start()]).strip() or name.strip()


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s or "").strip("-").lower()
    return s or "product"


def _option_axes(description: dict | None, variant_text: str | None) -> tuple[list[str], list[str]]:
    """Best-effort recovery of (option_names, option_values) from the legacy
    description. Falls back to a synthetic 'Variant' axis."""
    if isinstance(description, dict):
        names_raw = description.get("option_names")
        values_raw = description.get("option_values")
        if isinstance(names_raw, str) and isinstance(values_raw, str):
            names = [p.strip() for p in names_raw.split("/") if p.strip()]
            values = [p.strip() for p in values_raw.split("/") if p.strip()]
            if names and values:
                return names, values
    if variant_text:
        return ["Variant"], [variant_text.strip()]
    return [], []


async def _ensure_legacy_columns(db: AsyncSession) -> dict[str, bool]:
    """Detect whether the legacy `price`, `quantity`, `image_url` columns
    still exist on `products`. Returns a presence map. The migration reads
    them via raw SQL when present so the SQLAlchemy model (which no longer
    declares them) doesn't get in the way."""
    result = await db.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'products' AND column_name IN ('price','quantity','image_url')"
    ))
    present = {row[0] for row in result.all()}
    return {c: c in present for c in ("price", "quantity", "image_url")}


async def _fetch_legacy_products(db: AsyncSession, has: dict[str, bool]) -> list[dict]:
    """Return one dict per legacy product row, with the columns we still
    need to read from the pre-migration shape."""
    cols = ["id", "shop_id", "name", "description", "handle", "default_variant_id"]
    if has["price"]:
        cols.append("price")
    if has["quantity"]:
        cols.append("quantity")
    if has["image_url"]:
        cols.append("image_url")
    stmt = text(f"SELECT {', '.join(cols)} FROM products ORDER BY shop_id, name, id")
    result = await db.execute(stmt)
    rows = []
    for row in result.mappings().all():
        rows.append(dict(row))
    return rows


def _group_key(shop_id: int, base: str, description: dict | None) -> str:
    """Stable per-shop group key. Prefer an explicit description handle;
    else fall back to a slug of the base name + variant_group counter so
    different products that share a base name don't collide."""
    if isinstance(description, dict):
        handle = description.get("product_handle") or description.get("handle")
        if isinstance(handle, str) and handle.strip():
            return f"{shop_id}::{handle.strip()}"
    return f"{shop_id}::{_slugify(base)}"


async def migrate(dry_run: bool) -> None:
    await create_tables()  # makes sure new columns/tables exist before we run

    async with AsyncSessionLocal() as db:
        has = await _ensure_legacy_columns(db)
        if not any(has.values()):
            log.info("No legacy price/quantity/image_url columns on products — nothing to migrate.")
            return

        legacy_rows = await _fetch_legacy_products(db, has)
        log.info("Loaded %d legacy product rows", len(legacy_rows))

        # Group by (shop_id, base_name / handle).
        groups: dict[str, list[dict]] = defaultdict(list)
        bases: dict[str, str] = {}
        for row in legacy_rows:
            base = _base_name(row["name"], row.get("description"))
            key = _group_key(row["shop_id"], base, row.get("description"))
            groups[key].append(row)
            bases.setdefault(key, base)

        log.info("Grouped into %d parent products", len(groups))

        # Old product id → (new parent id, new variant id) for cart remap.
        legacy_to_new: dict[int, tuple[int, int]] = {}

        for key, rows in groups.items():
            shop_id = rows[0]["shop_id"]
            base = bases[key]
            handle = key.split("::", 1)[1]

            # Reuse the first legacy row as the parent (preserves id, FKs,
            # embedding). The remaining rows become orphans that we'll
            # convert into variants and then delete.
            rows.sort(key=lambda r: r["id"])
            parent_row = rows[0]

            parent_id = parent_row["id"]
            parent_desc = parent_row.get("description") or {}
            log.info("  parent %d: %s (%d variant rows)", parent_id, base, len(rows))

            if dry_run:
                continue

            # Update parent: name, handle, description (drop variant-specific
            # fields). default_variant_id is set after variants are inserted.
            cleaned_desc = dict(parent_desc) if isinstance(parent_desc, dict) else {}
            for k in ("variant", "variant_group", "option_names", "option_values"):
                cleaned_desc.pop(k, None)
            await db.execute(
                update(Product)
                .where(Product.id == parent_id)
                .values(name=base, handle=handle, description=cleaned_desc or None)
            )

            first_variant_id: int | None = None
            for r in rows:
                variant_text = None
                desc = r.get("description") or {}
                if isinstance(desc, dict):
                    variant_text = desc.get("variant")
                option_names, option_values = _option_axes(desc, variant_text)
                variant_label = r["name"] or base

                price = r.get("price") if has["price"] else None
                quantity = r.get("quantity") if has["quantity"] else 0
                image_url = r.get("image_url") if has["image_url"] else None

                # Skip if a variant for this legacy id already exists
                # (idempotent re-run).
                existing = (await db.execute(
                    select(ProductVariant).where(
                        ProductVariant.product_id == parent_id,
                        ProductVariant.variant_label == variant_label,
                        ProductVariant.price == (price or Decimal("0")),
                    )
                )).scalars().first()
                if existing:
                    variant = existing
                else:
                    variant = ProductVariant(
                        product_id=parent_id,
                        variant_index=len(legacy_to_new.values()) + 1,  # cosmetic only
                        option_names=option_names,
                        option_values=option_values,
                        price=Decimal(str(price)) if price is not None else Decimal("0"),
                        quantity=int(quantity or 0),
                        image_url=image_url,
                        variant_label=variant_label,
                    )
                    db.add(variant)
                    await db.flush()
                legacy_to_new[r["id"]] = (parent_id, variant.id)
                if first_variant_id is None:
                    first_variant_id = variant.id

            # Set default_variant_id and delete the extra legacy parent rows
            # (which are now superfluous after the data was moved to variants).
            await db.execute(
                update(Product)
                .where(Product.id == parent_id)
                .values(default_variant_id=first_variant_id)
            )
            for r in rows[1:]:
                await db.execute(text("DELETE FROM products WHERE id = :id"), {"id": r["id"]})

        if dry_run:
            log.info("Dry run complete; no changes written.")
            return

        # Remap cart rows. Cart used to FK product_id; now it uses variant_id.
        log.info("Remapping cart rows…")
        cart_rows = (await db.execute(
            text("SELECT id, product_id FROM cart_items WHERE variant_id IS NULL AND product_id IS NOT NULL")
        )).all()
        remapped = 0
        for cid, pid in cart_rows:
            mapping = legacy_to_new.get(pid)
            if mapping is None:
                continue
            _, vid = mapping
            await db.execute(text(
                "UPDATE cart_items SET variant_id = :vid WHERE id = :cid"
            ), {"vid": vid, "cid": cid})
            remapped += 1
        log.info("Remapped %d cart rows", remapped)

        # Drop any cart rows that couldn't be mapped (the underlying product
        # was deleted). Keeping them would violate the new NOT NULL.
        orphans = await db.execute(
            text("DELETE FROM cart_items WHERE variant_id IS NULL RETURNING id")
        )
        log.info("Removed %d orphan cart rows", len(orphans.all()))

        # Finally, drop the legacy columns now that all data has moved.
        log.info("Dropping legacy product columns…")
        for col in ("price", "quantity", "image_url"):
            if has[col]:
                await db.execute(text(f"ALTER TABLE products DROP COLUMN IF EXISTS {col}"))
        await db.execute(text("ALTER TABLE cart_items DROP COLUMN IF EXISTS product_id"))
        await db.execute(text("ALTER TABLE cart_items ALTER COLUMN variant_id SET NOT NULL"))

        await db.commit()
        log.info("Migration committed.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Log changes without committing.")
    args = parser.parse_args()
    asyncio.run(migrate(args.dry_run))


if __name__ == "__main__":
    main()
