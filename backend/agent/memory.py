"""Short-term (session turns) and long-term (user_memory) helpers."""
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from agent.prompt_safety import wrap_untrusted
from db.models import AgentTurn, UserMemory, SavedProduct, Product

MAX_SHORT_TERM_TURNS = 20   # last N turns loaded into context
MAX_LONG_TERM_KEYS = 50     # cap per user
MAX_MEMORY_VALUE_CHARS = 500

# Reserved key prefixes / names inside user_memory so the same table can host
# multiple kinds of long-term memory without colliding.
NOTE_KEY_PREFIX = "note:"
PREF_KEYS = ("pref:sizes", "pref:budget", "pref:likes", "pref:dislikes")
MAX_NOTE_CHARS = 280


async def load_short_term(session_id: int, db: AsyncSession) -> list[dict]:
    """Return last MAX_SHORT_TERM_TURNS turns as Claude message dicts."""
    result = await db.execute(
        select(AgentTurn)
        .where(AgentTurn.session_id == session_id)
        .order_by(AgentTurn.created_at.desc())
        .limit(MAX_SHORT_TERM_TURNS)
    )
    turns = list(reversed(result.scalars().all()))

    messages = []
    # Track tool_use ids emitted by the most recent assistant turn so we can
    # drop orphaned tool_result blocks (from older bugs where UI component ids
    # were saved as tool_use_ids). Claude 400s if a tool_result references an
    # id that wasn't in the immediately preceding assistant message.
    pending_tool_use_ids: set[str] = set()
    for turn in turns:
        if turn.role == "user":
            content = turn.content
            # content can be a string, a list (tool_result blocks), or empty
            if not content:
                continue
            if isinstance(content, list):
                cleaned = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        if block.get("tool_use_id") in pending_tool_use_ids:
                            cleaned.append(block)
                            pending_tool_use_ids.discard(block.get("tool_use_id"))
                        else:
                            # Orphan tool_result — convert to plain text so the
                            # answer isn't lost but Claude doesn't 400.
                            text = block.get("content")
                            if isinstance(text, str) and text:
                                cleaned.append({"type": "text", "text": text})
                    else:
                        cleaned.append(block)
                if not cleaned:
                    continue
                messages.append({"role": "user", "content": cleaned})
            else:
                messages.append({"role": "user", "content": content})
            pending_tool_use_ids = set()
        elif turn.role == "assistant":
            # Reconstruct full assistant content block list
            content: list = []
            if turn.content:
                if isinstance(turn.content, list):
                    # Already stored as list of typed blocks (text + tool_use)
                    content = turn.content
                elif isinstance(turn.content, str):
                    content = [{"type": "text", "text": turn.content}]
                # dict means a single block — shouldn't happen but handle it
                elif isinstance(turn.content, dict):
                    content = [turn.content]

            # If content was stored without tool_calls embedded (legacy), append them
            if turn.tool_calls:
                existing_ids = {b.get("id") for b in content if isinstance(b, dict) and b.get("type") == "tool_use"}
                for tc in turn.tool_calls:
                    if tc.get("id") not in existing_ids:
                        content.append(tc)

            if not content:
                continue

            messages.append({"role": "assistant", "content": content})

            # Tool results go back as a user message so Claude can continue
            if turn.tool_results:
                messages.append({"role": "user", "content": turn.tool_results})
    return messages


def _note_text(value: Any) -> str:
    """Notes are stored as {'text': str, 'created_at': iso}, but tolerate legacy str values."""
    if isinstance(value, dict):
        t = value.get("text")
        return t if isinstance(t, str) else str(value)
    return str(value)


async def load_long_term(user_id: int, db: AsyncSession) -> str:
    """Return long-term memory as a formatted string for the system prompt.

    Memory is grouped so Mason can act on each kind appropriately:
      - Notes (free-form facts about the user)
      - Preferences (sizes / budget / likes / dislikes)
      - Saved products (ids the user told Mason to remember)
      - Other (legacy keys saved via save_preference for arbitrary keys)
    """
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id).order_by(UserMemory.updated_at.desc())
    )
    memories = result.scalars().all()

    notes: list[str] = []
    prefs: dict[str, str] = {}
    other: list[tuple[str, str]] = []
    for m in memories:
        v = str(m.value if not isinstance(m.value, dict) else m.value)[:MAX_MEMORY_VALUE_CHARS]
        if m.key.startswith(NOTE_KEY_PREFIX):
            notes.append(_note_text(m.value)[:MAX_MEMORY_VALUE_CHARS])
        elif m.key in PREF_KEYS:
            prefs[m.key.split(":", 1)[1]] = v
        else:
            other.append((m.key, v))

    saved = await list_saved_products(user_id, db)

    if not notes and not prefs and not saved and not other:
        return ""

    sections: list[str] = []

    if notes:
        sections.append(
            "### Notes about the user\n"
            + "\n".join(f"- {n}" for n in notes)
        )
    if prefs:
        pref_lines = [f"- {k}: {prefs[k]}" for k in ("sizes", "budget", "likes", "dislikes") if k in prefs]
        sections.append("### Preferences\n" + "\n".join(pref_lines))
    if saved:
        saved_lines = [
            f"- #{p['product_id']} {p['name']} ({p['shop_name'] or 'unknown shop'})"
            for p in saved
        ]
        sections.append("### Saved products\n" + "\n".join(saved_lines))
    if other:
        other_lines = [f"- {k}: {v}" for k, v in other]
        sections.append("### Other remembered facts\n" + "\n".join(other_lines))

    body = "\n\n".join(sections)
    # User-controlled content — wrap so the model treats it as data, not instructions.
    return "## What Mason remembers about this user\n" + wrap_untrusted(body, label="user_memory")


# ── Notes ───────────────────────────────────────────────────────────────────

async def list_notes(user_id: int, db: AsyncSession) -> list[dict]:
    """Return notes for the UI sorted newest-first."""
    result = await db.execute(
        select(UserMemory)
        .where(UserMemory.user_id == user_id, UserMemory.key.like(f"{NOTE_KEY_PREFIX}%"))
        .order_by(UserMemory.created_at.desc())
    )
    out = []
    for m in result.scalars().all():
        out.append({
            "key": m.key,
            "text": _note_text(m.value),
            "created_at": m.created_at.isoformat() if m.created_at else None,
        })
    return out


async def add_note(user_id: int, text: str, db: AsyncSession) -> dict:
    """Insert a new note. Returns the created row dict."""
    text = (text or "").strip()[:MAX_NOTE_CHARS]
    if not text:
        raise ValueError("empty note")

    # Skip silent duplicates so Mason re-saving the same fact doesn't pile up.
    existing = await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.key.like(f"{NOTE_KEY_PREFIX}%"),
        )
    )
    for row in existing.scalars().all():
        if _note_text(row.value).strip().lower() == text.lower():
            return {
                "key": row.key,
                "text": _note_text(row.value),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }

    await _evict_if_full(user_id, db)
    key = f"{NOTE_KEY_PREFIX}{uuid.uuid4().hex}"
    value = {"text": text, "created_at": datetime.now(timezone.utc).isoformat()}
    row = UserMemory(user_id=user_id, key=key, value=value)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return {
        "key": row.key,
        "text": text,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def delete_note(user_id: int, key: str, db: AsyncSession) -> bool:
    if not key.startswith(NOTE_KEY_PREFIX):
        return False
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.key == key)
    )
    row = result.scalars().first()
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


# ── Preferences (the four canonical fields) ─────────────────────────────────

async def get_prefs(user_id: int, db: AsyncSession) -> dict[str, str]:
    result = await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.key.in_(PREF_KEYS),
        )
    )
    out = {"sizes": "", "budget": "", "likes": "", "dislikes": ""}
    for m in result.scalars().all():
        field = m.key.split(":", 1)[1]
        v = m.value
        if isinstance(v, dict):
            v = v.get("value") or v.get("text") or ""
        out[field] = str(v)[:MAX_MEMORY_VALUE_CHARS]
    return out


async def set_prefs(user_id: int, patch: dict, db: AsyncSession) -> dict[str, str]:
    """Upsert a subset of the four pref fields. Empty string deletes the row."""
    valid = {"sizes", "budget", "likes", "dislikes"}
    for field, value in (patch or {}).items():
        if field not in valid:
            continue
        key = f"pref:{field}"
        if value is None or (isinstance(value, str) and not value.strip()):
            # empty -> delete the row so it disappears from long-term memory
            result = await db.execute(
                select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.key == key)
            )
            row = result.scalars().first()
            if row:
                await db.delete(row)
            continue
        await save_preference(user_id, key, value, db)
    return await get_prefs(user_id, db)


# ── Saved products ──────────────────────────────────────────────────────────

async def list_saved_products(user_id: int, db: AsyncSession) -> list[dict]:
    from db.models import Shop
    result = await db.execute(
        select(SavedProduct, Product, Shop.name.label("shop_name"))
        .join(Product, Product.id == SavedProduct.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(SavedProduct.user_id == user_id)
        .order_by(SavedProduct.created_at.desc())
    )
    out = []
    for saved, product, shop_name in result.all():
        out.append({
            "product_id": product.id,
            "name": product.name,
            "price": float(product.price),
            "quantity": product.quantity,
            "image_url": product.image_url,
            "shop_id": product.shop_id,
            "shop_name": shop_name,
            "saved_at": saved.created_at.isoformat() if saved.created_at else None,
        })
    return out


async def save_product(user_id: int, product_id: int, db: AsyncSession) -> bool:
    """Insert a SavedProduct row if not already saved. Returns True if newly saved."""
    existing = await db.execute(
        select(SavedProduct).where(
            SavedProduct.user_id == user_id,
            SavedProduct.product_id == product_id,
        )
    )
    if existing.scalars().first():
        return False
    # Make sure the product actually exists so we don't store dangling refs.
    product = await db.execute(select(Product).where(Product.id == product_id))
    if not product.scalars().first():
        raise ValueError(f"product {product_id} not found")
    db.add(SavedProduct(user_id=user_id, product_id=product_id))
    await db.flush()
    return True


async def unsave_product(user_id: int, product_id: int, db: AsyncSession) -> bool:
    result = await db.execute(
        select(SavedProduct).where(
            SavedProduct.user_id == user_id,
            SavedProduct.product_id == product_id,
        )
    )
    row = result.scalars().first()
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


# ── Cap helpers ─────────────────────────────────────────────────────────────

async def _evict_if_full(user_id: int, db: AsyncSession):
    """If at the cap, drop the oldest user_memory row to make space."""
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id).order_by(UserMemory.updated_at.asc())
    )
    rows = result.scalars().all()
    if len(rows) >= MAX_LONG_TERM_KEYS:
        await db.delete(rows[0])
        await db.flush()


async def save_turn(
    session_id: int,
    role: str,
    content: Any,
    tool_calls: list | None,
    tool_results: list | None,
    db: AsyncSession,
):
    turn = AgentTurn(
        session_id=session_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
        tool_results=tool_results,
    )
    db.add(turn)
    await db.flush()


async def save_preference(user_id: int, key: str, value: Any, db: AsyncSession):
    """Upsert a long-term memory key. Evicts oldest if over cap."""
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.key == key)
    )
    existing = result.scalars().first()
    if existing:
        existing.value = value
    else:
        await _evict_if_full(user_id, db)
        db.add(UserMemory(user_id=user_id, key=key, value=value))
    await db.flush()
