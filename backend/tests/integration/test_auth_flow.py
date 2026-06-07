"""Register → login → authenticated request → admin gating.

Smoke-tests the integration rig (DB container, app, dependency override,
SAVEPOINT isolation).
"""
import pytest
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


async def test_register_creates_user_with_hashed_password(client, db_session):
    from db.models import User

    r = await client.post(
        "/api/auth/register",
        json={"email": "alice@example.com", "password": "hunter2hunter2"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "alice@example.com"
    assert body["access_token"]

    row = (await db_session.execute(
        select(User).where(User.email == "alice@example.com")
    )).scalars().first()
    assert row is not None
    assert row.password_hash != "hunter2hunter2"
    assert row.password_hash.startswith("$2")  # bcrypt prefix


async def test_login_returns_jwt(client, make_user):
    user, _ = await make_user(email="bob@example.com", password="hunter2hunter2")

    r = await client.post(
        "/api/auth/login",
        json={"email": "bob@example.com", "password": "hunter2hunter2"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    assert token

    # Decoded sub matches user id.
    from jose import jwt
    from config import settings
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    assert payload["sub"] == str(user.id)


async def test_login_wrong_password_returns_401(client, make_user):
    await make_user(email="c@example.com", password="rightpassword12")
    r = await client.post(
        "/api/auth/login",
        json={"email": "c@example.com", "password": "WRONGWRONGWRONG"},
    )
    assert r.status_code == 401


async def test_me_with_valid_token(client, make_user):
    user, headers = await make_user(email="d@example.com")
    r = await client.get("/api/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["email"] == "d@example.com"


async def test_me_with_garbage_token(client):
    r = await client.get(
        "/api/auth/me", headers={"Authorization": "Bearer garbage.token.value"}
    )
    assert r.status_code == 401


async def test_admin_endpoint_rejects_non_admin(client, make_user):
    _, headers = await make_user(email="nonadmin@example.com", is_admin=False)
    r = await client.get("/api/admin/shops", headers=headers)
    assert r.status_code == 403


async def test_admin_endpoint_allows_admin(client, make_user):
    _, headers = await make_user(email="admin@example.com", is_admin=True)
    r = await client.get("/api/admin/shops", headers=headers)
    assert r.status_code == 200


async def test_register_payload_drops_is_admin(client, db_session):
    from db.models import User

    r = await client.post(
        "/api/auth/register",
        json={
            "email": "sneaky@example.com",
            "password": "hunter2hunter2",
            "is_admin": True,
        },
    )
    assert r.status_code == 201
    row = (await db_session.execute(
        select(User).where(User.email == "sneaky@example.com")
    )).scalars().first()
    assert row.is_admin is False
