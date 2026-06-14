"""
Scraper ingestor — takes validated scraper output (list of row dicts) and
persists it into the database using the shared import helpers.

Public surface:
  ingest_scraper_output(db, rows, seller_type) -> ScraperVerificationReport
"""
from __future__ import annotations

import random
from collections import defaultdict
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Product, ProductVariant, Shop
from db.schemas import ScraperVerificationReport, SampleProduct
from utils.import_helpers import upsert_product_group, upsert_shop

# ---------------------------------------------------------------------------
# Field sets (mirrors scraper_builder.REQUIRED_FIELDS / OPTIONAL_FIELDS)
# ---------------------------------------------------------------------------

_REQUIRED_FIELDS: list[str] = [
    "shop_name",
    "product_handle",
    "base_product_name",
    "product_name",
    "price",
    "quantity",
    "image_url",
    "description_json",
]

_OPTIONAL_FIELDS: list[str] = [
    "variant_id",
    "variant_index",
    "option_names",
    "option_values",
    "parent_store",
]

_ALL_FIELDS: list[str] = _REQUIRED_FIELDS + _OPTIONAL_FIELDS


# ---------------------------------------------------------------------------
# Confidence scorer
# ---------------------------------------------------------------------------


def _score_confidence(
    errors: list[str],
    products_ingested: int,
    fields_found: list[str],
    fields_missing: list[str],
) -> str:
    """Return "high", "medium", or "low" based on ingestion quality signals."""
    required_all_found = all(f in fields_found for f in _REQUIRED_FIELDS)

    if not errors and products_ingested >= 5 and required_all_found and not fields_missing:
        return "high"

    if len(errors) <= 3 and products_ingested >= 3 and required_all_found:
        return "medium"

    return "low"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def ingest_scraper_output(
    db: AsyncSession,
    rows: list[dict],
    seller_type: str,
) -> ScraperVerificationReport:
    """Ingest validated scraper rows into the database.

    Steps:
      1. Collect unique shop names and upsert each shop.
      2. Group rows by (shop_name, product_handle).
      3. Upsert each product group via the shared helper.
      4. Commit the session.
      5. Build and return a ScraperVerificationReport.
    """
    shops_created: int = 0
    shops_updated: int = 0
    products_ingested: int = 0
    products_updated: int = 0
    variants_ingested: int = 0
    errors: list[str] = []
    ingested_shop_ids: list[int] = []
    ingested_product_ids: list[int] = []

    # ── Step 1: collect unique shop names ───────────────────────────────────
    unique_shop_names: list[str] = []
    seen_names: set[str] = set()
    for row in rows:
        name = (row.get("shop_name") or "").strip()
        if name and name not in seen_names:
            unique_shop_names.append(name)
            seen_names.add(name)

    # ── Step 2: upsert shops ────────────────────────────────────────────────
    shop_cache: dict[str, Shop] = {}
    for shop_name in unique_shop_names:
        try:
            shop, created = await upsert_shop(db, shop_name)
            shop_cache[shop_name] = shop
            if created:
                shops_created += 1
                ingested_shop_ids.append(shop.id)
            else:
                shops_updated += 1
        except Exception as exc:
            errors.append(f"Failed to upsert shop {shop_name!r}: {exc}")

    # ── Step 3: group rows by (shop_name, product_handle) ───────────────────
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        shop_name = (row.get("shop_name") or "").strip()
        handle = (row.get("product_handle") or "").strip()
        if shop_name and handle:
            groups[(shop_name, handle)].append(row)
        else:
            errors.append(
                f"Row skipped: missing shop_name or product_handle "
                f"(shop_name={row.get('shop_name')!r}, handle={row.get('product_handle')!r})"
            )

    # ── Step 4: upsert product groups ───────────────────────────────────────
    for (shop_name, handle), group_rows in groups.items():
        shop: Optional[Shop] = shop_cache.get(shop_name)
        if shop is None:
            errors.append(
                f"Skipping product group ({shop_name!r}, {handle!r}): "
                "shop was not ingested successfully"
            )
            continue
        try:
            product, variants, created = await upsert_product_group(
                db, shop, handle, group_rows
            )
            if created:
                products_ingested += 1
                ingested_product_ids.append(product.id)
            else:
                products_updated += 1
            variants_ingested += len(variants)
        except Exception as exc:
            errors.append(
                f"Failed to upsert product ({shop_name!r}, {handle!r}): {exc}"
            )

    # ── Step 5: commit ──────────────────────────────────────────────────────
    await db.commit()

    # ── Step 6: build report ────────────────────────────────────────────────

    # Sample up to 3 rows for the report.
    sample_size = min(3, len(rows))
    sampled_rows = random.sample(rows, sample_size) if sample_size else []
    sample_products: list[SampleProduct] = [
        SampleProduct(
            name=row.get("base_product_name", ""),
            price=row.get("price", ""),
            image_url=row.get("image_url", ""),
            shop_name=row.get("shop_name", ""),
        )
        for row in sampled_rows
    ]

    # Determine which fields appear (non-empty) in at least one row.
    fields_found: list[str] = []
    for field in _ALL_FIELDS:
        if any((row.get(field) or "").strip() for row in rows):
            fields_found.append(field)

    # parent_store is only meaningful for multi-seller marketplaces — don't
    # flag it as missing on single-seller sites.
    optional_to_check = [
        f for f in _OPTIONAL_FIELDS
        if not (f == "parent_store" and seller_type in ("single", "unknown"))
    ]
    fields_missing: list[str] = [
        f for f in optional_to_check if f not in fields_found
    ]

    confidence = _score_confidence(errors, products_ingested, fields_found, fields_missing)

    return ScraperVerificationReport(
        shops_created=shops_created,
        shops_updated=shops_updated,
        products_ingested=products_ingested,
        products_updated=products_updated,
        variants_ingested=variants_ingested,
        fields_found=fields_found,
        fields_missing=fields_missing,
        sample_products=sample_products,
        confidence=confidence,
        errors=errors,
        ingested_shop_ids=ingested_shop_ids,
        ingested_product_ids=ingested_product_ids,
    )
