"""Cart lifecycle end-to-end.

Add → merge → stock guard → variant requirement → modify → delete →
cross-user isolation.
"""
from decimal import Decimal

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


async def test_add_item_creates_line(client, make_user, seed_shop_with_variants):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("12.50"), "quantity": 10}]
    )
    vid = seed["variants"][0].id

    r = await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 2}, headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["added"] is True
    assert body["cart"]["item_count"] == 1
    assert body["cart"]["total"] == 25.0


async def test_same_variant_added_twice_merges_quantity(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("5.00"), "quantity": 10}]
    )
    vid = seed["variants"][0].id

    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 2}, headers=headers
    )
    r = await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 3}, headers=headers
    )
    assert r.status_code == 200
    cart = r.json()["cart"]
    assert cart["item_count"] == 1
    assert cart["items"][0]["quantity"] == 5
    assert cart["total"] == 25.0


async def test_add_quantity_exceeding_stock_returns_409(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("10.00"), "quantity": 2}]
    )
    vid = seed["variants"][0].id

    r = await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 5}, headers=headers
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["reason"] == "insufficient_stock"
    assert detail["available"] == 2


async def test_multi_variant_product_requires_variant_id(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[
            {"price": Decimal("10.00"), "quantity": 5},
            {"price": Decimal("12.00"), "quantity": 5},
        ],
    )
    pid = seed["product"].id

    r = await client.post(
        "/api/cart/items", json={"product_id": pid, "quantity": 1}, headers=headers
    )
    assert r.status_code == 400
    assert r.json()["detail"]["reason"] == "variant_required"


async def test_single_variant_product_accepts_product_id(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("10.00"), "quantity": 5}]
    )
    pid = seed["product"].id

    r = await client.post(
        "/api/cart/items", json={"product_id": pid, "quantity": 1}, headers=headers
    )
    assert r.status_code == 200


async def test_get_cart_total_equals_sum_of_subtotals(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed_a = await seed_shop_with_variants(
        product_name="A", variants=[{"price": Decimal("3.50"), "quantity": 10}]
    )
    seed_b = await seed_shop_with_variants(
        product_name="B", variants=[{"price": Decimal("7.25"), "quantity": 10}]
    )

    await client.post(
        "/api/cart/items",
        json={"variant_id": seed_a["variants"][0].id, "quantity": 2},
        headers=headers,
    )
    await client.post(
        "/api/cart/items",
        json={"variant_id": seed_b["variants"][0].id, "quantity": 1},
        headers=headers,
    )

    r = await client.get("/api/cart", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["item_count"] == 2
    assert body["total"] == 14.25  # 3.50*2 + 7.25*1
    line_sum = round(sum(item["subtotal"] for item in body["items"]), 2)
    assert line_sum == body["total"]


async def test_patch_quantity_zero_removes_line(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("5.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id

    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 2}, headers=headers
    )
    r = await client.patch(
        f"/api/cart/items/{vid}", json={"quantity": 0}, headers=headers
    )
    assert r.status_code == 200
    assert r.json()["cart"]["item_count"] == 0


async def test_delete_removes_line(
    client, make_user, seed_shop_with_variants
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("5.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id

    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 1}, headers=headers
    )
    r = await client.delete(f"/api/cart/items/{vid}", headers=headers)
    assert r.status_code == 200
    assert r.json()["cart"]["item_count"] == 0
    assert r.json()["cart"]["total"] == 0


async def test_cross_user_cart_isolation(
    client, make_user, seed_shop_with_variants
):
    _, headers_a = await make_user(email="usera@example.com")
    _, headers_b = await make_user(email="userb@example.com")
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("10.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id

    # User A adds something.
    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 1}, headers=headers_a
    )
    # User B's cart is empty.
    r = await client.get("/api/cart", headers=headers_b)
    assert r.status_code == 200
    assert r.json()["item_count"] == 0
    # User A still has their item.
    r = await client.get("/api/cart", headers=headers_a)
    assert r.json()["item_count"] == 1


async def test_cart_requires_auth(client):
    r = await client.get("/api/cart")
    assert r.status_code == 401
