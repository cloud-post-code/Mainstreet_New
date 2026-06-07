"""Integration test fixtures.

Spins up a real pgvector Postgres container per session, points the app's
engine at it, runs create_tables() once, and wraps each test in a
SAVEPOINT-rolled-back transaction for isolation.

If Docker isn't running, every integration test is skipped with a clear
reason — the unit suite stays green.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import AsyncIterator, Callable

import pytest
import pytest_asyncio


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


# Auto-mark every test in this directory as integration so
# `pytest -m "not integration"` skips them.
def pytest_collection_modifyitems(config, items):
    for item in items:
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)


# ── Postgres container ───────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def pg_container():
    """Start pgvector/pgvector:pg16 once per session. Skip if Docker missing."""
    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:
        pytest.skip("testcontainers not installed")

    try:
        container = (
            PostgresContainer("pgvector/pgvector:pg16", driver="asyncpg")
            .with_env("POSTGRES_DB", "test")
            .with_env("POSTGRES_USER", "postgres")
            .with_env("POSTGRES_PASSWORD", "postgres")
        )
        container.start()
    except Exception as e:
        pytest.skip(f"Docker not available: {e}")

    dsn = container.get_connection_url()  # postgresql+asyncpg://...
    os.environ["DATABASE_URL"] = dsn

    yield dsn

    container.stop()


@pytest_asyncio.fixture(scope="session")
async def _engine(pg_container):
    """Build the engine bound to the container and run schema setup once."""
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    # Swap the module-level engine in db.database so app code using it talks
    # to the test container.
    import db.database as db_module

    test_engine = create_async_engine(pg_container, poolclass=NullPool)
    db_module.engine = test_engine
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    db_module.AsyncSessionLocal = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    await db_module.create_tables()

    yield test_engine

    await test_engine.dispose()


@pytest_asyncio.fixture
async def db_session(_engine) -> AsyncIterator:
    """A per-test AsyncSession wrapped in a SAVEPOINT rolled back on teardown.

    Pattern: open a connection, begin an outer transaction, bind a Session to
    that connection, start a nested SAVEPOINT, and re-open the SAVEPOINT
    whenever inner code commits. Roll back the outer transaction at teardown.
    """
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy import event

    connection = await _engine.connect()
    trans = await connection.begin()
    session = AsyncSession(bind=connection, expire_on_commit=False)
    nested = await connection.begin_nested()

    @event.listens_for(session.sync_session, "after_transaction_end")
    def _restart_savepoint(sess, transaction):
        nonlocal nested
        if transaction.nested and not transaction._parent.nested:
            # Inner code committed; re-arm the savepoint synchronously.
            sess.begin_nested()

    try:
        yield session
    finally:
        await session.close()
        if trans.is_active:
            await trans.rollback()
        await connection.close()


# ── HTTP client over the FastAPI app ─────────────────────────────────────────


@pytest_asyncio.fixture
async def client(db_session) -> AsyncIterator:
    """httpx AsyncClient against the real app, with get_db overridden to
    yield the SAVEPOINT-bound session."""
    from httpx import ASGITransport, AsyncClient

    from db.database import get_db
    from main import app

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── User factory ─────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def make_user(db_session) -> Callable:
    """Factory: make_user(email='a@x.com', password='pw...', is_admin=False)
    → (user, {'Authorization': 'Bearer ...'})."""
    from auth import create_access_token, hash_password
    from db.models import User

    counter = {"n": 0}

    async def _make(
        email: str | None = None,
        password: str = "testpassword1234",
        is_admin: bool = False,
    ):
        counter["n"] += 1
        em = email or f"user{counter['n']}@example.com"
        user = User(
            email=em,
            password_hash=hash_password(password),
            display_name=em.split("@")[0],
            is_admin=is_admin,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        headers = {"Authorization": f"Bearer {create_access_token(user.id)}"}
        return user, headers

    return _make


# ── Stripe mock ──────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def stripe_mock():
    """Start stripe/stripe-mock and point the SDK at it for the session."""
    try:
        from testcontainers.core.container import DockerContainer
        from testcontainers.core.waiting_utils import wait_for_logs
    except ImportError:
        pytest.skip("testcontainers not installed")

    try:
        container = DockerContainer("stripe/stripe-mock").with_exposed_ports(12111)
        container.start()
        wait_for_logs(container, "Listening for HTTP")
    except Exception as e:
        pytest.skip(f"Docker not available: {e}")

    host = container.get_container_host_ip()
    port = container.get_exposed_port(12111)
    base_url = f"http://{host}:{port}"

    import stripe
    original_base = stripe.api_base
    original_key = stripe.api_key
    stripe.api_base = base_url
    stripe.api_key = "sk_test_dummy"

    # Also patch the settings object so cart.py's import-time check sees a key.
    from config import settings
    original_settings_key = settings.stripe_secret_key
    settings.stripe_secret_key = "sk_test_dummy"

    yield base_url

    stripe.api_base = original_base
    stripe.api_key = original_key
    settings.stripe_secret_key = original_settings_key
    container.stop()


# ── Shop + variants factory ──────────────────────────────────────────────────


@pytest_asyncio.fixture
async def seed_shop_with_variants(db_session) -> Callable:
    """Factory: insert a shop + parent product + N variants. Returns dict."""
    from decimal import Decimal
    from db.models import Product, ProductVariant, Shop

    counter = {"n": 0}

    async def _make(
        shop_name: str | None = None,
        product_name: str = "Test Product",
        handle: str | None = None,
        variants: list[dict] | None = None,
    ):
        counter["n"] += 1
        sname = shop_name or f"Shop {counter['n']}"
        h = handle or f"prod-{counter['n']}"

        from sqlalchemy import select
        shop = (await db_session.execute(
            select(Shop).where(Shop.name == sname)
        )).scalars().first()
        if shop is None:
            shop = Shop(name=sname)
            db_session.add(shop)
            await db_session.flush()

        product = Product(
            shop_id=shop.id,
            handle=h,
            name=product_name,
            shop_name_cached=shop.name,
        )
        db_session.add(product)
        await db_session.flush()

        variant_specs = variants or [
            {"price": Decimal("10.00"), "quantity": 5}
        ]
        variant_rows = []
        for i, spec in enumerate(variant_specs, start=1):
            v = ProductVariant(
                product_id=product.id,
                variant_index=spec.get("variant_index", i),
                option_names=spec.get("option_names", []),
                option_values=spec.get("option_values", []),
                price=spec.get("price", Decimal("10.00")),
                quantity=spec.get("quantity", 5),
                image_url=spec.get("image_url"),
                variant_label=spec.get("variant_label", f"Variant {i}"),
            )
            db_session.add(v)
            variant_rows.append(v)
        await db_session.flush()

        # default_variant_id = first variant
        product.default_variant_id = variant_rows[0].id
        await db_session.commit()

        return {"shop": shop, "product": product, "variants": variant_rows}

    return _make
