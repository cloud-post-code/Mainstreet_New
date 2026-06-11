"""Reranker path through _search_products.

Patches agent.reranker.rerank to return a known reorder; asserts the search
function honors the reranker's output and truncates to the requested limit.
"""
from decimal import Decimal

import pytest

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def fake_embed_texts(monkeypatch):
    async def _fake(texts):
        return [None] * len(texts)
    monkeypatch.setattr("agent.embeddings.embed_texts", _fake)


@pytest.fixture(autouse=True)
def fake_rewrite_query(monkeypatch):
    async def _fake(q, db=None):
        return [q]
    monkeypatch.setattr("agent.embeddings.rewrite_query", _fake)


@pytest.fixture
def force_rerank_on(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "zeroentropy_rerank_enabled", True)
    monkeypatch.setattr(settings, "zeroentropy_api_key", "test-key")
    monkeypatch.setattr(settings, "zeroentropy_rerank_pool", 30)


async def test_search_products_applies_reranker_order(
    seed_shop_with_variants, db_session, monkeypatch, force_rerank_on
):
    """Three matching products → reranker reverses RRF order → search returns reversed."""
    await seed_shop_with_variants(
        shop_name="Shop A",
        product_name="Wool Hat Alpha",
        handle="wool-hat-alpha",
        variants=[{"price": Decimal("10"), "quantity": 1}],
    )
    await seed_shop_with_variants(
        shop_name="Shop A",
        product_name="Wool Hat Bravo",
        handle="wool-hat-bravo",
        variants=[{"price": Decimal("10"), "quantity": 1}],
    )
    await seed_shop_with_variants(
        shop_name="Shop A",
        product_name="Wool Hat Charlie",
        handle="wool-hat-charlie",
        variants=[{"price": Decimal("10"), "quantity": 1}],
    )

    async def _fake_rerank(query, docs, top_n):
        return list(reversed(range(len(docs)))), {"latency_ms": 1, "pool_size": len(docs)}

    monkeypatch.setattr("agent.tools._zerank_rerank", _fake_rerank)

    from agent.tools import _search_products

    out = await _search_products({"query": "wool hat", "limit": 3}, db_session)
    names = [p["name"] for p in out["products"]]
    # RRF order is roughly insertion order; reversed by the fake reranker.
    assert len(names) == 3
    assert names[0].endswith("Charlie")
    assert names[-1].endswith("Alpha")


async def test_search_products_truncates_to_limit_after_rerank(
    seed_shop_with_variants, db_session, monkeypatch, force_rerank_on
):
    for letter in ["A", "B", "C", "D", "E"]:
        await seed_shop_with_variants(
            shop_name="Shop A",
            product_name=f"Wool Hat {letter}",
            handle=f"wool-hat-{letter.lower()}",
            variants=[{"price": Decimal("10"), "quantity": 1}],
        )

    async def _fake_rerank(query, docs, top_n):
        return list(range(len(docs))), {"latency_ms": 1, "pool_size": len(docs)}

    monkeypatch.setattr("agent.tools._zerank_rerank", _fake_rerank)
    from agent.tools import _search_products
    out = await _search_products({"query": "wool hat", "limit": 2}, db_session)
    assert len(out["products"]) == 2


async def test_search_products_surfaces_reranker_error(
    seed_shop_with_variants, db_session, monkeypatch, force_rerank_on
):
    await seed_shop_with_variants(
        shop_name="Shop A",
        product_name="Wool Hat Alpha",
        handle="wool-hat-alpha",
        variants=[{"price": Decimal("10"), "quantity": 1}],
    )
    await seed_shop_with_variants(
        shop_name="Shop A",
        product_name="Wool Hat Bravo",
        handle="wool-hat-bravo",
        variants=[{"price": Decimal("10"), "quantity": 1}],
    )

    from agent.reranker import RerankerError

    async def _bad(query, docs, top_n):
        raise RerankerError("simulated timeout")

    monkeypatch.setattr("agent.tools._zerank_rerank", _bad)

    from agent.tools import _search_products
    with pytest.raises(RerankerError):
        await _search_products({"query": "wool hat", "limit": 3}, db_session)
