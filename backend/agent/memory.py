"""Short-term (session turns) and long-term (user_memory) helpers."""
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from agent.prompt_safety import wrap_untrusted
from db.models import AgentTurn, UserMemory, SavedProduct, Product, UserPreferences

MAX_SHORT_TERM_TURNS = 20   # last N turns loaded into context
MAX_LONG_TERM_KEYS = 50     # cap per user
MAX_MEMORY_VALUE_CHARS = 500

# Reserved key prefixes / names inside user_memory so the same table can host
# multiple kinds of long-term memory without colliding.
NOTE_KEY_PREFIX = "note:"
# Legacy pref keys (free-text). Still read so old data isn't lost; new writes go
# to the user_preferences table.
LEGACY_PREF_KEYS = ("pref:sizes", "pref:budget", "pref:likes", "pref:dislikes")
MAX_NOTE_CHARS = 280

EMPTY_PREFS: dict = {
    "sizes": {},
    "style_tags": [],
    "quality_price": None,
    "bulk_individual": None,
    "discover_known": None,
    "gift_budget": {},
    "personal_budget": None,
    "lifestyle": {},
    "likes": [],
    "dislikes": [],
}


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
    legacy_prefs: dict[str, str] = {}
    other: list[tuple[str, str]] = []
    for m in memories:
        v = str(m.value if not isinstance(m.value, dict) else m.value)[:MAX_MEMORY_VALUE_CHARS]
        if m.key.startswith(NOTE_KEY_PREFIX):
            notes.append(_note_text(m.value)[:MAX_MEMORY_VALUE_CHARS])
        elif m.key in LEGACY_PREF_KEYS:
            legacy_prefs[m.key.split(":", 1)[1]] = v
        else:
            other.append((m.key, v))

    prefs = await get_prefs(user_id, db)
    pref_block = _format_prefs_for_prompt(prefs)

    saved = await list_saved_products(user_id, db)

    if not notes and not pref_block and not legacy_prefs and not saved and not other:
        return ""

    sections: list[str] = []

    if notes:
        sections.append(
            "### Notes about the user\n"
            + "\n".join(f"- {n}" for n in notes)
        )
    if pref_block:
        sections.append("### Preferences\n" + pref_block)
    if legacy_prefs:
        pref_lines = [f"- {k}: {legacy_prefs[k]}" for k in ("sizes", "budget", "likes", "dislikes") if k in legacy_prefs]
        sections.append("### Legacy preferences (free-text)\n" + "\n".join(pref_lines))
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


# ── Structured preferences (user_preferences table) ─────────────────────────

_SLIDER_FIELDS = {"quality_price", "bulk_individual", "discover_known"}
_JSONB_FIELDS = {"sizes", "gift_budget", "lifestyle"}
_ARRAY_FIELDS = {"style_tags", "likes", "dislikes"}


def _row_to_prefs(row: UserPreferences | None) -> dict:
    if row is None:
        return {**EMPTY_PREFS, "sizes": {}, "gift_budget": {}, "lifestyle": {},
                "style_tags": [], "likes": [], "dislikes": []}
    return {
        "sizes": row.sizes or {},
        "style_tags": list(row.style_tags or []),
        "quality_price": row.quality_price,
        "bulk_individual": row.bulk_individual,
        "discover_known": row.discover_known,
        "gift_budget": row.gift_budget or {},
        "personal_budget": row.personal_budget,
        "lifestyle": row.lifestyle or {},
        "likes": list(row.likes or []),
        "dislikes": list(row.dislikes or []),
    }


async def get_prefs(user_id: int, db: AsyncSession) -> dict:
    result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == user_id)
    )
    row = result.scalars().first()
    if row is None:
        # One-time backfill from legacy free-text pref:* rows in user_memory.
        backfilled = await _backfill_legacy_prefs(user_id, db)
        if backfilled is not None:
            return _row_to_prefs(backfilled)
    return _row_to_prefs(row)


async def set_prefs(user_id: int, patch: dict, db: AsyncSession) -> dict:
    """Merge a partial patch into the user's preferences row.

    Top-level keys are merged: JSONB fields are shallow-merged with the patch
    object, arrays/sliders/numbers are replaced. Missing keys are left alone.
    """
    if not isinstance(patch, dict):
        patch = {}

    result = await db.execute(
        select(UserPreferences).where(UserPreferences.user_id == user_id)
    )
    row = result.scalars().first()
    if row is None:
        row = UserPreferences(user_id=user_id)
        db.add(row)

    for field, value in patch.items():
        if field in _JSONB_FIELDS:
            current = dict(getattr(row, field) or {})
            if isinstance(value, dict):
                # Shallow merge — null/"" entries clear that subkey.
                for k, v in value.items():
                    if v is None or v == "":
                        current.pop(k, None)
                    else:
                        current[k] = v
                setattr(row, field, current)
            elif value is None:
                setattr(row, field, {})
        elif field in _ARRAY_FIELDS:
            if isinstance(value, list):
                cleaned = [str(x).strip()[:120] for x in value if str(x).strip()]
                # De-dupe preserving order
                seen = set()
                deduped = []
                for x in cleaned:
                    k = x.lower()
                    if k in seen:
                        continue
                    seen.add(k)
                    deduped.append(x)
                setattr(row, field, deduped[:50])
            elif value is None:
                setattr(row, field, [])
        elif field in _SLIDER_FIELDS:
            if value is None:
                setattr(row, field, None)
            else:
                try:
                    n = int(value)
                except (TypeError, ValueError):
                    continue
                setattr(row, field, max(1, min(5, n)))
        elif field == "personal_budget":
            if value is None or value == "":
                row.personal_budget = None
            else:
                try:
                    row.personal_budget = max(0, int(value))
                except (TypeError, ValueError):
                    continue

    await db.flush()
    await db.refresh(row)
    return _row_to_prefs(row)


async def _backfill_legacy_prefs(user_id: int, db: AsyncSession) -> UserPreferences | None:
    """If the user only has legacy pref:* rows in user_memory, materialize them
    into a user_preferences row. Returns the new row, or None if nothing legacy
    was found."""
    result = await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.key.in_(LEGACY_PREF_KEYS),
        )
    )
    legacy = {}
    for m in result.scalars().all():
        field = m.key.split(":", 1)[1]
        v = m.value
        if isinstance(v, dict):
            v = v.get("value") or v.get("text") or ""
        legacy[field] = str(v)
    if not legacy:
        return None
    row = UserPreferences(user_id=user_id)
    # Budget: try to extract a number.
    raw_budget = legacy.get("budget", "")
    digits = "".join(ch for ch in raw_budget if ch.isdigit())
    if digits:
        try:
            row.personal_budget = int(digits)
        except ValueError:
            pass
    if raw_budget:
        row.gift_budget = {"freeform": raw_budget[:200]}
    # Sizes: stash as freeform for now; user can re-fill structured fields.
    if legacy.get("sizes"):
        row.sizes = {"freeform": legacy["sizes"][:200]}
    # Likes / dislikes split on commas.
    for k in ("likes", "dislikes"):
        raw = legacy.get(k, "")
        if raw:
            parts = [p.strip() for p in raw.split(",") if p.strip()]
            setattr(row, k, parts[:50])
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


def _format_prefs_for_prompt(p: dict) -> str:
    """Render structured prefs as a compact prose block for Mason's prompt."""
    lines: list[str] = []
    sizes = p.get("sizes") or {}
    if sizes:
        bits = []
        if sizes.get("shirt"): bits.append(f"shirt {sizes['shirt']}")
        if sizes.get("waist"): bits.append(f"waist {sizes['waist']}")
        if sizes.get("inseam"): bits.append(f"inseam {sizes['inseam']}")
        if sizes.get("shoe"):
            g = sizes.get("shoe_gender")
            bits.append(f"shoe {sizes['shoe']}{f' ({g})' if g else ''}")
        if sizes.get("dress"): bits.append(f"dress {sizes['dress']}")
        if sizes.get("hat"): bits.append(f"hat {sizes['hat']}")
        if sizes.get("ring"): bits.append(f"ring {sizes['ring']}")
        if sizes.get("freeform"): bits.append(sizes["freeform"])
        if bits:
            lines.append(f"- Sizes: {', '.join(bits)}")
    if p.get("style_tags"):
        lines.append(f"- Style: {', '.join(p['style_tags'])}")
    if p.get("quality_price") is not None:
        lines.append(f"- Quality vs price: {p['quality_price']}/5 (1=budget, 5=premium)")
    if p.get("bulk_individual") is not None:
        lines.append(f"- Bulk vs individual: {p['bulk_individual']}/5 (1=individual, 5=bulk)")
    if p.get("discover_known") is not None:
        lines.append(f"- Discover vs known: {p['discover_known']}/5 (1=stick to known, 5=surprise me)")
    if p.get("personal_budget") is not None:
        lines.append(f"- Personal budget: ${p['personal_budget']}")
    gb = p.get("gift_budget") or {}
    if gb:
        gb_bits = []
        for k in ("default", "birthday", "holiday", "anniversary"):
            if gb.get(k):
                gb_bits.append(f"{k} ${gb[k]}")
        if gb.get("freeform"):
            gb_bits.append(gb["freeform"])
        if gb_bits:
            lines.append(f"- Gift budget: {', '.join(gb_bits)}")
    ls = p.get("lifestyle") or {}
    if ls:
        ls_bits = []
        for label, key in [
            ("housing", "housing"), ("area", "area"),
            ("cooking", "cooking"), ("travel", "travel"),
            ("work env", "work_env"),
        ]:
            if ls.get(key):
                ls_bits.append(f"{label} {ls[key]}")
        if ls.get("pets"):
            pets = ls["pets"] if isinstance(ls["pets"], list) else [ls["pets"]]
            ls_bits.append(f"pets {', '.join(pets)}")
        if ls.get("pets_notes"):
            ls_bits.append(f"pet notes: {ls['pets_notes']}")
        if ls.get("hobbies"):
            hobbies = ls["hobbies"] if isinstance(ls["hobbies"], list) else [ls["hobbies"]]
            if hobbies:
                ls_bits.append(f"hobbies {', '.join(hobbies)}")
        if ls.get("fitness"):
            fit = ls["fitness"] if isinstance(ls["fitness"], list) else [ls["fitness"]]
            if fit:
                ls_bits.append(f"fitness {', '.join(fit)}")
        if ls_bits:
            lines.append(f"- Lifestyle: {'; '.join(ls_bits)}")
    if p.get("likes"):
        lines.append(f"- Likes: {', '.join(p['likes'])}")
    if p.get("dislikes"):
        lines.append(f"- Dislikes: {', '.join(p['dislikes'])}")
    return "\n".join(lines)


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
    return turn


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
