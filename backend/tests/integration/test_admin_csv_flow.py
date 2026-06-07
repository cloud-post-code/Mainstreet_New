"""Admin CSV import → DB → export round-trip.

Patches embed_texts to return None vectors so we don't need an OpenAI client.
"""
import csv
import io
from pathlib import Path

import pytest
from sqlalchemy import func, select

pytestmark = pytest.mark.asyncio

FIXTURE_CSV = Path(__file__).parent / "fixtures" / "sample_import.csv"


@pytest.fixture(autouse=True)
def fake_embed_texts(monkeypatch):
    """Avoid any real OpenAI call during admin import."""
    async def _fake(texts):
        return [None] * len(texts)

    monkeypatch.setattr("routers.admin.embed_texts", _fake)


async def test_import_creates_shops_products_variants(
    client, make_user, db_session
):
    from db.models import Product, ProductVariant, Shop

    _, headers = await make_user(is_admin=True)
    csv_bytes = FIXTURE_CSV.read_bytes()
    r = await client.post(
        "/api/admin/import",
        files={"file": ("sample_import.csv", csv_bytes, "text/csv")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rows_added"] == 3  # 3 distinct parent products
    assert body["errors"] == []

    shops = (await db_session.execute(select(func.count(Shop.id)))).scalar()
    products = (await db_session.execute(select(func.count(Product.id)))).scalar()
    variants = (
        await db_session.execute(select(func.count(ProductVariant.id)))
    ).scalar()
    assert shops == 2
    assert products == 3
    assert variants == 5

    # Default variant set to variant_index=1 row for the wool hat.
    hat = (await db_session.execute(
        select(Product).where(Product.handle == "wool-hat")
    )).scalars().first()
    assert hat is not None
    default_v = (await db_session.execute(
        select(ProductVariant).where(ProductVariant.id == hat.default_variant_id)
    )).scalars().first()
    assert default_v.variant_index == 1


async def test_reimport_is_idempotent(client, make_user, db_session):
    from db.models import Product, ProductVariant

    _, headers = await make_user(is_admin=True)
    csv_bytes = FIXTURE_CSV.read_bytes()
    await client.post(
        "/api/admin/import",
        files={"file": ("sample_import.csv", csv_bytes, "text/csv")},
        headers=headers,
    )
    r2 = await client.post(
        "/api/admin/import",
        files={"file": ("sample_import.csv", csv_bytes, "text/csv")},
        headers=headers,
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["rows_updated"] == 3
    assert body["rows_added"] == 0

    products = (
        await db_session.execute(select(func.count(Product.id)))
    ).scalar()
    variants = (
        await db_session.execute(select(func.count(ProductVariant.id)))
    ).scalar()
    assert products == 3
    assert variants == 5


async def test_malformed_row_reported_in_errors(client, make_user):
    _, headers = await make_user(is_admin=True)
    bad_csv = (
        "shop_name,product_handle,base_product_name,product_name,variant_id,"
        "variant_index,option_names,option_values,price,quantity,image_url,"
        "description_json\n"
        "Acme,good,Good Product,Good Variant,1,1,,,10.00,5,,\n"
        "Acme,bad,Bad Product,Bad Variant,2,1,,,NOT_A_PRICE,5,,\n"
    )
    r = await client.post(
        "/api/admin/import",
        files={"file": ("bad.csv", bad_csv.encode(), "text/csv")},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    # Good row inserted, bad row reported.
    assert body["rows_added"] >= 1
    assert len(body["errors"]) >= 1
    assert any("price" in (e["error"].lower()) for e in body["errors"])


async def test_export_includes_parent_store_column(client, make_user):
    _, headers = await make_user(is_admin=True)
    csv_bytes = FIXTURE_CSV.read_bytes()
    await client.post(
        "/api/admin/import",
        files={"file": ("sample_import.csv", csv_bytes, "text/csv")},
        headers=headers,
    )
    r = await client.get("/api/admin/export/products", headers=headers)
    assert r.status_code == 200
    text = r.text
    reader = csv.DictReader(io.StringIO(text))
    assert "parent_store" in reader.fieldnames
    rows = list(reader)
    assert len(rows) == 5  # 5 variants


async def test_import_missing_required_column_returns_400(client, make_user):
    _, headers = await make_user(is_admin=True)
    # Mirrors the Boston CSV shape — missing many required columns.
    bad_csv = b"shop_name,product_name,price\nAcme,Hat,10.00\n"
    r = await client.post(
        "/api/admin/import",
        files={"file": ("bad.csv", bad_csv, "text/csv")},
        headers=headers,
    )
    assert r.status_code == 400
    assert "Missing columns" in r.json()["detail"]


async def test_import_requires_admin(client, make_user):
    _, headers = await make_user(is_admin=False)
    r = await client.post(
        "/api/admin/import",
        files={"file": ("x.csv", b"", "text/csv")},
        headers=headers,
    )
    assert r.status_code == 403
