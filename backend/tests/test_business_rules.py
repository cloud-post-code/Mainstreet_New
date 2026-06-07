"""Higher-level business rules.

Covers product hydration, CSV import grouping logic, and cart add/set_quantity
behavior using mocked DB sessions (no real Postgres needed).
"""
import asyncio
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.admin import _hydrate_product_out, _split_options
from routers.cart import _resolve_variant_id, add_item, set_quantity


def _run(coro):
    return asyncio.run(coro)


def _variant(**kw):
    defaults = dict(
        id=1, product_id=1, external_variant_id=None, variant_index=1,
        option_names=[], option_values=[], price=Decimal("10.00"),
        quantity=5, image_url=None, variant_label=None, description=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _product(**kw):
    defaults = dict(
        id=1, shop_id=1, handle="prod", name="Product",
        description=None, default_variant_id=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# ── _hydrate_product_out ─────────────────────────────────────────────────────

def test_hydrate_no_variants():
    out = _hydrate_product_out(_product(), "Acme", [])
    assert out.variants == []
    assert out.price_range is None
    assert out.in_stock is False
    assert out.default_variant_id is None
    assert out.image_url is None


def test_hydrate_single_variant():
    v = _variant(id=10, price=Decimal("5.00"), quantity=3, image_url="http://x/img.png")
    out = _hydrate_product_out(_product(), "Acme", [v])
    assert out.default_variant_id == 10
    assert out.price_range.min == Decimal("5.00") and out.price_range.max == Decimal("5.00")
    assert out.in_stock is True
    assert out.image_url == "http://x/img.png"


def test_hydrate_multiple_variants_price_range():
    vs = [
        _variant(id=1, price=Decimal("5.00"), quantity=0),
        _variant(id=2, price=Decimal("15.00"), quantity=2),
        _variant(id=3, price=Decimal("10.00"), quantity=0),
    ]
    out = _hydrate_product_out(_product(), "Acme", vs)
    assert out.price_range.min == Decimal("5.00")
    assert out.price_range.max == Decimal("15.00")
    assert out.in_stock is True  # any variant with quantity > 0


def test_hydrate_in_stock_false_when_all_zero():
    vs = [_variant(id=1, quantity=0), _variant(id=2, quantity=0)]
    out = _hydrate_product_out(_product(), "Acme", vs)
    assert out.in_stock is False


def test_hydrate_uses_default_variant_for_image():
    vs = [
        _variant(id=1, image_url="http://x/first.png"),
        _variant(id=2, image_url="http://x/default.png"),
    ]
    out = _hydrate_product_out(_product(default_variant_id=2), "Acme", vs)
    assert out.image_url == "http://x/default.png"
    assert out.default_variant_id == 2


def test_hydrate_falls_back_to_first_variant_when_default_missing():
    vs = [_variant(id=1, image_url="http://x/first.png"),
          _variant(id=2, image_url="http://x/second.png")]
    # default_variant_id=99 doesn't match any → fall back to first.
    out = _hydrate_product_out(_product(default_variant_id=99), "Acme", vs)
    assert out.default_variant_id == 1
    assert out.image_url == "http://x/first.png"


# ── CSV grouping logic ──────────────────────────────────────────────────────
# Mirror import_csv's grouping: rows grouped by (shop_name, product_handle).
# We test the pure grouping pattern with the same data shape.

def _group_rows(rows):
    groups: dict[tuple[str, str], list] = {}
    for i, row in enumerate(rows, start=2):
        key = (row["shop_name"], row["product_handle"])
        groups.setdefault(key, []).append((i, row))
    return groups


def test_grouping_same_shop_same_handle():
    rows = [
        {"shop_name": "Acme", "product_handle": "hat", "variant_index": "1"},
        {"shop_name": "Acme", "product_handle": "hat", "variant_index": "2"},
    ]
    groups = _group_rows(rows)
    assert len(groups) == 1
    assert len(groups[("Acme", "hat")]) == 2


def test_grouping_same_handle_different_shops_kept_separate():
    rows = [
        {"shop_name": "Acme", "product_handle": "hat"},
        {"shop_name": "Beta", "product_handle": "hat"},
    ]
    groups = _group_rows(rows)
    assert len(groups) == 2


# ── _split_options round-trip ───────────────────────────────────────────────

def test_split_options_round_trip_via_join():
    original = ["Red", "Small"]
    joined = " / ".join(original)
    assert _split_options(joined) == original


# ── _resolve_variant_id ──────────────────────────────────────────────────────
# Async + DB. Use AsyncMock to fake the SQLAlchemy session.

def _fake_db_with_first(value):
    """Make a fake AsyncSession whose execute(...).scalars().first() returns value."""
    db = MagicMock()
    exec_result = MagicMock()
    exec_result.scalars.return_value.first.return_value = value
    db.execute = AsyncMock(return_value=exec_result)
    return db


def test_resolve_explicit_variant_id_passthrough():
    db = MagicMock()  # never queried
    assert _run(_resolve_variant_id(variant_id=42, product_id=None, db=db)) == 42


def test_resolve_neither_returns_none():
    db = MagicMock()
    assert _run(_resolve_variant_id(variant_id=None, product_id=None, db=db)) is None


def test_resolve_product_with_default_variant():
    product = _product(id=5, default_variant_id=100)
    db = _fake_db_with_first(product)
    assert _run(_resolve_variant_id(variant_id=None, product_id=5, db=db)) == 100


def test_resolve_product_without_default_uses_first_variant():
    # First execute returns the product; second returns the lowest-index variant.
    product = _product(id=5, default_variant_id=None)
    variant = _variant(id=200)

    db = MagicMock()
    results = [MagicMock(), MagicMock()]
    results[0].scalars.return_value.first.return_value = product
    results[1].scalars.return_value.first.return_value = variant
    db.execute = AsyncMock(side_effect=results)
    assert _run(_resolve_variant_id(variant_id=None, product_id=5, db=db)) == 200


def test_resolve_missing_product_returns_none():
    db = _fake_db_with_first(None)
    assert _run(_resolve_variant_id(variant_id=None, product_id=999, db=db)) is None


# ── add_item validation paths (no DB required) ───────────────────────────────

def test_add_item_rejects_zero_quantity():
    db = MagicMock()
    result = _run(add_item(variant_id=1, quantity=0, db=db))
    assert result == {"added": False, "reason": "quantity_must_be_positive"}


def test_add_item_rejects_negative_quantity():
    db = MagicMock()
    result = _run(add_item(variant_id=1, quantity=-5, db=db))
    assert result["added"] is False
    assert result["reason"] == "quantity_must_be_positive"
