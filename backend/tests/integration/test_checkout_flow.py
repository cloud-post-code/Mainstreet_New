"""Checkout flow: cart → Stripe checkout session, plus webhook handling.

Stripe Checkout session creation uses stripe-mock (real SDK, fake server).
Webhook signing uses the real stripe.WebhookSignature so we exercise the
exact verification code path in cart.py:430.
"""
import json
import time
from decimal import Decimal

import pytest
import stripe
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


# ── checkout session creation (needs stripe-mock) ────────────────────────────


async def test_empty_cart_checkout_returns_no_url(
    client, make_user, stripe_mock
):
    _, headers = await make_user()
    r = await client.post("/api/cart/checkout", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["checkout_url"] is None
    assert body["items_count"] == 0


async def test_checkout_creates_stripe_session(
    client, make_user, seed_shop_with_variants, stripe_mock
):
    _, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[
            {"price": Decimal("9.99"), "quantity": 5, "image_url": "http://x/i.png"},
        ]
    )
    vid = seed["variants"][0].id

    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 2}, headers=headers
    )
    r = await client.post("/api/cart/checkout", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["checkout_url"] is not None
    assert body["session_id"]
    assert body["items_count"] == 1
    assert body["total"] == 19.98


# ── webhook signature verification ───────────────────────────────────────────


def _sign(payload: str, secret: str) -> str:
    """Build a valid Stripe-Signature header using the official SDK helper."""
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload}"
    sig = stripe.WebhookSignature._compute_signature(signed_payload, secret)
    return f"t={timestamp},v1={sig}"


async def test_webhook_bad_signature_returns_400(client):
    from config import settings

    original = settings.stripe_webhook_secret
    settings.stripe_webhook_secret = "whsec_test"
    try:
        r = await client.post(
            "/api/cart/webhook",
            content='{"id":"evt_1"}',
            headers={"stripe-signature": "t=1,v1=garbage"},
        )
        assert r.status_code == 400
    finally:
        settings.stripe_webhook_secret = original


async def test_webhook_missing_secret_returns_503(client):
    from config import settings

    original = settings.stripe_webhook_secret
    settings.stripe_webhook_secret = ""
    try:
        r = await client.post("/api/cart/webhook", content='{}')
        assert r.status_code == 503
    finally:
        settings.stripe_webhook_secret = original


async def test_webhook_completed_event_clears_cart(
    client, make_user, seed_shop_with_variants, db_session
):
    from config import settings
    from db.models import CartItem

    user, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("5.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id
    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 1}, headers=headers
    )

    # Confirm cart has an item.
    pre = (await db_session.execute(
        select(CartItem).where(CartItem.user_id == user.id)
    )).scalars().all()
    assert len(pre) == 1

    secret = "whsec_test_secret"
    original = settings.stripe_webhook_secret
    settings.stripe_webhook_secret = secret
    try:
        event_body = json.dumps({
            "id": "evt_test_1",
            "object": "event",
            "api_version": "2024-06-20",
            "type": "checkout.session.completed",
            "data": {"object": {"client_reference_id": str(user.id)}},
        })
        r = await client.post(
            "/api/cart/webhook",
            content=event_body,
            headers={"stripe-signature": _sign(event_body, secret)},
        )
        assert r.status_code == 200, r.text
        assert r.json()["received"] is True
    finally:
        settings.stripe_webhook_secret = original

    post = (await db_session.execute(
        select(CartItem).where(CartItem.user_id == user.id)
    )).scalars().all()
    assert len(post) == 0


async def test_webhook_idempotent_on_repeat(
    client, make_user, seed_shop_with_variants
):
    """Second delivery of the same completed event should still return 200
    and leave the cart cleared — no error."""
    from config import settings

    user, headers = await make_user()
    seed = await seed_shop_with_variants(
        variants=[{"price": Decimal("5.00"), "quantity": 5}]
    )
    vid = seed["variants"][0].id
    await client.post(
        "/api/cart/items", json={"variant_id": vid, "quantity": 1}, headers=headers
    )

    secret = "whsec_test_secret"
    original = settings.stripe_webhook_secret
    settings.stripe_webhook_secret = secret
    try:
        event_body = json.dumps({
            "id": "evt_test_2",
            "object": "event",
            "api_version": "2024-06-20",
            "type": "checkout.session.completed",
            "data": {"object": {"client_reference_id": str(user.id)}},
        })
        sig = _sign(event_body, secret)
        r1 = await client.post(
            "/api/cart/webhook", content=event_body,
            headers={"stripe-signature": sig},
        )
        r2 = await client.post(
            "/api/cart/webhook", content=event_body,
            headers={"stripe-signature": _sign(event_body, secret)},
        )
        assert r1.status_code == 200
        assert r2.status_code == 200
    finally:
        settings.stripe_webhook_secret = original
