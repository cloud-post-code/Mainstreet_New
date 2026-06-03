"""Personalized welcome-screen prompt suggestions.

Generates 4 short shopping prompts tailored to a user's saved preferences,
recent session topics, and current cart. Cached per user in UserMemory for
30 minutes so the welcome screen doesn't fire an LLM call on every render.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import AgentSession, CartItem, Product, UserMemory
from agent.memory import load_long_term, save_preference

logger = logging.getLogger(__name__)

FALLBACK_SUGGESTIONS = [
    "Find me running shoes under $100",
    "What shops sell electronics?",
    "I need a gift for a home cook",
    "Show me in-stock yoga gear",
]

CACHE_KEY = "suggested_prompts"
CACHE_TTL = timedelta(minutes=30)
MODEL = "claude-haiku-4-5-20251001"


async def _recent_session_titles(user_id: int, db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(AgentSession.title)
        .where(AgentSession.user_id == user_id)
        .order_by(AgentSession.updated_at.desc())
        .limit(5)
    )
    return [t for t in result.scalars().all() if t and t not in ("New conversation", "Guest conversation")]


async def _cart_product_names(user_id: int, db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(Product.name)
        .join(CartItem, CartItem.product_id == Product.id)
        .where(CartItem.user_id == user_id)
        .limit(10)
    )
    return [n for n in result.scalars().all() if n]


def _read_cache(memory_row: UserMemory | None) -> list[str] | None:
    if not memory_row:
        return None
    value = memory_row.value
    if not isinstance(value, dict):
        return None
    generated_at = value.get("generated_at")
    suggestions = value.get("suggestions")
    if not isinstance(generated_at, str) or not isinstance(suggestions, list):
        return None
    try:
        ts = datetime.fromisoformat(generated_at)
    except ValueError:
        return None
    if datetime.now(timezone.utc) - ts > CACHE_TTL:
        return None
    if not _validate_suggestions(suggestions):
        return None
    return suggestions  # type: ignore[return-value]


def _validate_suggestions(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(s, str) and 1 <= len(s) <= 80 for s in value)
    )


def _generate_with_claude(signals: str) -> list[str]:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    system = (
        "You generate welcome-screen prompt chips for a personal-shopper chat assistant. "
        "Produce exactly 4 concise prompts (≤8 words each) that this specific user would plausibly "
        "send. Vary the categories — don't repeat a single theme. Write in first person, like the "
        "user is asking. Return STRICT JSON only, no prose, in this shape: "
        '{"suggestions": ["...", "...", "...", "..."]}'
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=200,
        system=system,
        messages=[{"role": "user", "content": signals}],
    )
    text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text += block.text
    parsed = json.loads(text)
    suggestions = parsed.get("suggestions")
    if not _validate_suggestions(suggestions):
        raise ValueError(f"invalid suggestions shape: {suggestions!r}")
    return suggestions


async def get_suggestions(user_id: int, db: AsyncSession) -> list[str]:
    """Return 4 personalized prompts, falling back to static defaults on any failure."""
    # Check cache first
    cache_row = (
        await db.execute(
            select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.key == CACHE_KEY)
        )
    ).scalars().first()
    cached = _read_cache(cache_row)
    if cached is not None:
        return cached

    # Gather signals
    long_term = await load_long_term(user_id, db)
    titles = await _recent_session_titles(user_id, db)
    cart_names = await _cart_product_names(user_id, db)

    # Cold start — nothing to personalize from
    if not long_term and not titles and not cart_names:
        return FALLBACK_SUGGESTIONS

    signals_parts = []
    if long_term:
        signals_parts.append(long_term)
    if titles:
        signals_parts.append("## Recent conversation topics\n" + "\n".join(f"- {t}" for t in titles))
    if cart_names:
        signals_parts.append("## Items currently in cart\n" + "\n".join(f"- {n}" for n in cart_names))
    signals = "\n\n".join(signals_parts)

    try:
        suggestions = _generate_with_claude(signals)
    except Exception as exc:
        logger.warning("suggestion generation failed for user %s: %s", user_id, exc)
        return FALLBACK_SUGGESTIONS

    await save_preference(
        user_id,
        CACHE_KEY,
        {"generated_at": datetime.now(timezone.utc).isoformat(), "suggestions": suggestions},
        db,
    )
    await db.commit()
    return suggestions
