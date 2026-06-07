"""Agent dispatcher contract.

The cart router's bare async functions (add_item, set_quantity, view, etc.)
are also called from agent/tools.py. Their return-dict shape is the contract.
These tests pin the shape so signature drift between HTTP and agent callers
fails loudly.
"""
from decimal import Decimal

import pytest

from routers.cart import add_item, set_quantity, view

pytestmark = pytest.mark.asyncio


async def test_add_item_returned_dict_matches_http_result(
    client, make_user, seed_shop_with_variants, db_session
):
    user, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("10.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id

    direct = await add_item(
        variant_id=vid, quantity=1, user_id=user.id, db=db_session,
    )
    await db_session.commit()

    # Same call via HTTP. Reset the prior add to keep stock identical.
    await client.delete(f"/api/cart/items/{vid}", headers=headers)
    r = await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 1}, headers=headers
    )
    http_result = r.json()["result"]

    # Keys must match — agent and HTTP callers depend on the same shape.
    assert set(direct.keys()) == set(http_result.keys())
    assert direct["added"] is True and http_result["added"] is True


async def test_insufficient_stock_dict_has_expected_keys(
    make_user, seed_shop_with_variants, db_session
):
    user, _ = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("10.00"), "quantity": 1}]
    )
    vid = seed["variants"][0].id

    result = await add_item(
        variant_id=vid, quantity=99, user_id=user.id, db=db_session,
    )
    assert result["added"] is False
    assert result["reason"] == "insufficient_stock"
    # Keys the HTTP layer's _raise_for_reason depends on.
    for key in ("variant_id", "product_id", "product_name", "available", "in_cart"):
        assert key in result, f"missing key {key}"


async def test_variant_required_dict_shape(
    make_user, seed_shop_with_variants, db_session
):
    user, _ = await make_user()
    seed = await seed_shop_with_variants(
        variants=[
            {"price": Decimal("10.00"), "quantity": 5},
            {"price": Decimal("12.00"), "quantity": 5},
        ]
    )
    pid = seed["product"].id

    result = await add_item(
        variant_id=None, product_id=pid, quantity=1,
        user_id=user.id, db=db_session,
    )
    assert result["added"] is False
    assert result["reason"] == "variant_required"
    assert result["product_id"] == pid


async def test_view_returns_expected_top_level_keys(
    make_user, seed_shop_with_variants, db_session
):
    user, _ = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("3.00"), "quantity": 5}]
    )
    await add_item(
        variant_id=seed["variants"][0].id, quantity=2,
        user_id=user.id, db=db_session,
    )
    await db_session.commit()

    result = await view(user_id=user.id, session_id=None, db=db_session)
    assert set(result.keys()) == {"items", "item_count", "total"}
    assert result["item_count"] == 1
    assert result["total"] == 6.0


async def test_set_quantity_zero_removes_line(
    make_user, seed_shop_with_variants, db_session
):
    user, _ = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("3.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id
    await add_item(variant_id=vid, quantity=2, user_id=user.id, db=db_session)
    await db_session.commit()

    result = await set_quantity(
        variant_id=vid, quantity=0, user_id=user.id,
        session_id=None, db=db_session,
    )
    assert result["updated"] is True
    assert result["removed"] is True
