"""Does this decide whether something is allowed?

Tests for permission / authorization helpers.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from auth import get_admin_user
from db.models import CartItem
from routers.cart import _owner_filter


# ── get_admin_user ───────────────────────────────────────────────────────────
# get_admin_user is an async dependency that wraps get_current_user. We call
# it directly with a fake User to assert the role check.

import asyncio


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_admin_user_passes_for_admin():
    admin = SimpleNamespace(id=1, is_admin=True)
    result = _run(get_admin_user(current_user=admin))
    assert result is admin


def test_admin_user_raises_403_for_non_admin():
    user = SimpleNamespace(id=2, is_admin=False)
    with pytest.raises(HTTPException) as exc:
        _run(get_admin_user(current_user=user))
    assert exc.value.status_code == 403


# ── _owner_filter ────────────────────────────────────────────────────────────
# Pure: returns a SQLAlchemy expression. We compile it to a string to assert
# which column is filtered. This is the SQL boundary — we don't actually
# execute it.

def _compile(expr) -> str:
    return str(expr.compile(compile_kwargs={"literal_binds": True}))


def test_owner_filter_authenticated_user():
    sql = _compile(_owner_filter(user_id=42, session_id=None))
    assert "cart_items.user_id = 42" in sql
    assert "session_id" not in sql


def test_owner_filter_anonymous_session():
    sql = _compile(_owner_filter(user_id=None, session_id=7))
    assert "cart_items.session_id = 7" in sql
    assert "cart_items.user_id IS NULL" in sql


def test_owner_filter_user_id_takes_precedence_over_session_id():
    """If both are supplied, user_id wins — anonymous-cart hijack defense."""
    sql = _compile(_owner_filter(user_id=42, session_id=999))
    assert "cart_items.user_id = 42" in sql
    assert "session_id = 999" not in sql


# ── variant-selection enforcement ────────────────────────────────────────────
# The check inside add_item: if product has >1 variant and only product_id
# is supplied, refuse. We replicate the predicate as a pure function for testing.

def _require_variant_selection(*, variant_id: int | None, product_id: int | None, variant_count: int) -> dict | None:
    """Pure mirror of add_item's variant-selection branch (cart.py:119-129)."""
    if variant_id is None and product_id is not None and variant_count > 1:
        return {"added": False, "reason": "variant_required", "product_id": product_id}
    return None


def test_multi_variant_without_variant_id_rejected():
    err = _require_variant_selection(variant_id=None, product_id=5, variant_count=3)
    assert err is not None and err["reason"] == "variant_required"


def test_multi_variant_with_variant_id_allowed():
    assert _require_variant_selection(variant_id=11, product_id=5, variant_count=3) is None


def test_single_variant_without_variant_id_allowed():
    assert _require_variant_selection(variant_id=None, product_id=5, variant_count=1) is None
