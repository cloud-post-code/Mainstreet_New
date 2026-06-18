"""Unit tests for GET /api/shops/public/full — first_product_image_url field."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.shops import list_shops_public_full


def _make_db(rows):
    """DB mock whose execute().all() returns `rows`."""
    db = MagicMock()
    result = MagicMock()
    result.all.return_value = rows
    db.execute = AsyncMock(return_value=result)
    return db


def _row(id, name, logo_url, description, website_url, product_count, first_product_image_url):
    r = MagicMock()
    r.id = id
    r.name = name
    r.logo_url = logo_url
    r.description = description
    r.website_url = website_url
    r.product_count = product_count
    r.first_product_image_url = first_product_image_url
    return r


def run(coro):
    return asyncio.run(coro)


def test_returns_first_product_image_url_when_no_logo():
    row = _row(1, "Acme Shop", None, "A shop", "https://acme.com", 5, "https://cdn.example.com/prod.jpg")
    db = _make_db([row])
    result = run(list_shops_public_full(limit=100, offset=0, db=db))
    assert result[0]["first_product_image_url"] == "https://cdn.example.com/prod.jpg"
    assert result[0]["logo_url"] is None


def test_returns_first_product_image_url_none_when_absent():
    row = _row(2, "Empty Shop", None, None, None, 0, None)
    db = _make_db([row])
    result = run(list_shops_public_full(limit=100, offset=0, db=db))
    assert result[0]["first_product_image_url"] is None


def test_returns_logo_url_when_present():
    row = _row(3, "Logo Shop", "https://logo.png", None, None, 3, "https://prod.png")
    db = _make_db([row])
    result = run(list_shops_public_full(limit=100, offset=0, db=db))
    assert result[0]["logo_url"] == "https://logo.png"
    assert result[0]["first_product_image_url"] == "https://prod.png"


def test_response_includes_all_expected_fields():
    row = _row(4, "Full Shop", "https://logo.png", "desc", "https://site.com", 10, "https://img.png")
    db = _make_db([row])
    result = run(list_shops_public_full(limit=100, offset=0, db=db))
    r = result[0]
    assert set(r.keys()) >= {"id", "name", "logo_url", "description", "website_url", "product_count", "first_product_image_url"}
