"""Product search end-to-end (embedding pipeline + filters).

Exercises tsvector trigger fired by the seed inserts and the discover endpoint.
embed_texts is mocked to return None so the pipeline falls back to the lex-only
SQL path — same result set, no OpenAI calls required in tests.
"""
from decimal import Decimal

import pytest

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def fake_embed_and_rewrite(monkeypatch):
    async def _fake_embed(texts):
        return [None] * len(texts)

    async def _fake_rewrite(query, db=None):
        return [query] if query else []

    monkeypatch.setattr("routers.admin.embed_texts", _fake_embed)
    monkeypatch.setattr("agent.tools.embed_texts", _fake_embed)
    monkeypatch.setattr("agent.tools.rewrite_query", _fake_rewrite)


async def _seed_catalog(seed_shop_with_variants):
    """Insert a small mixed catalog."""
    await seed_shop_with_variants(
        shop_name="Hat Co",
        product_name="Wool Hat",
        handle="wool-hat",
        variants=[{"price": Decimal("19.99"), "quantity": 5}],
    )
    await seed_shop_with_variants(
        shop_name="Hat Co",
        product_name="Cotton Scarf",
        handle="cotton-scarf",
        variants=[{"price": Decimal("9.50"), "quantity": 0}],
    )
    await seed_shop_with_variants(
        shop_name="Mug Co",
        product_name="Ceramic Mug",
        handle="ceramic-mug",
        variants=[{"price": Decimal("12.00"), "quantity": 8}],
    )


async def test_discover_returns_all_products_no_filter(
    client, seed_shop_with_variants
):
    await _seed_catalog(seed_shop_with_variants)
    r = await client.get("/api/products/discover")
    assert r.status_code == 200
    assert len(r.json()) == 3


async def test_discover_lexical_search(
    client, seed_shop_with_variants
):
    await _seed_catalog(seed_shop_with_variants)
    r = await client.get("/api/products/discover?q=wool")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert "Wool Hat" in names
    assert "Ceramic Mug" not in names


async def test_discover_filter_by_shop_id(
    client, seed_shop_with_variants, db_session
):
    await _seed_catalog(seed_shop_with_variants)
    from sqlalchemy import select
    from db.models import Shop
    hat_shop = (await db_session.execute(
        select(Shop).where(Shop.name == "Hat Co")
    )).scalars().first()

    r = await client.get(f"/api/products/discover?shop_id={hat_shop.id}")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert set(names) == {"Wool Hat", "Cotton Scarf"}


async def test_discover_filter_by_price_range(
    client, seed_shop_with_variants
):
    await _seed_catalog(seed_shop_with_variants)
    r = await client.get("/api/products/discover?min_price=10&max_price=15")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == ["Ceramic Mug"]


async def test_discover_in_stock_only_filter(
    client, seed_shop_with_variants
):
    await _seed_catalog(seed_shop_with_variants)
    r = await client.get("/api/products/discover?in_stock_only=true")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    # Cotton Scarf has quantity 0 → filtered out.
    assert "Cotton Scarf" not in names
    assert "Wool Hat" in names and "Ceramic Mug" in names


