"""Short-term (session turns) and long-term (user_memory) helpers."""
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from agent.prompt_safety import wrap_untrusted
from db.models import AgentTurn, UserMemory, SavedProduct, Product, ProductVariant, UserPreferences, Board, BoardProduct, BoardNote, BoardVibe, VibeSet, VibeSetItem

MAX_SHORT_TERM_TURNS = 20   # last N turns loaded into context
MAX_LONG_TERM_KEYS = 50     # cap per user
MAX_MEMORY_VALUE_CHARS = 500
MAX_SAVED_PRODUCTS = 200    # cap per user
MAX_PROMPT_SAVED_PRODUCTS = 50  # newest N surfaced in the system prompt
MAX_BOARDS = 50
MAX_BOARD_NOTE_CHARS = 500
MAX_BOARDS_IN_PROMPT = 10
MAX_PRODUCTS_PER_BOARD_IN_PROMPT = 20

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
      - Boards (named collections of saved products + notes)
      - Notes (free-form facts about the user not attached to a board)
      - Preferences (sizes / budget / likes / dislikes)
      - Other (legacy keys saved via save_preference for arbitrary keys)
    """
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id).order_by(UserMemory.updated_at.desc())
    )
    memories = result.scalars().all()

    legacy_prefs: dict[str, str] = {}
    other: list[tuple[str, str]] = []
    for m in memories:
        v = str(m.value if not isinstance(m.value, dict) else m.value)[:MAX_MEMORY_VALUE_CHARS]
        if m.key.startswith(NOTE_KEY_PREFIX):
            pass  # legacy notes are now stored as BoardNote rows on "My Board"
        elif m.key in LEGACY_PREF_KEYS:
            legacy_prefs[m.key.split(":", 1)[1]] = v
        else:
            other.append((m.key, v))

    prefs = await get_prefs(user_id, db)
    pref_block = _format_prefs_for_prompt(prefs)

    boards = await list_boards(user_id, db)

    if not pref_block and not legacy_prefs and not boards and not other:
        return ""

    sections: list[str] = []

    if boards:
        board_lines: list[str] = []
        for b in boards[:MAX_BOARDS_IN_PROMPT]:
            board_detail = await get_board(user_id, b["id"], db)
            header = f"**{b['name']}** (board_id={b['id']})"
            if b.get("description"):
                header += f" — \"{b['description']}\""
            board_lines.append(header)
            if board_detail["notes"]:
                board_lines.append("  Notes:")
                for n in board_detail["notes"]:
                    board_lines.append(f"  - {n['text']}")
            if board_detail["products"]:
                board_lines.append("  Products:")
                for p in board_detail["products"][:MAX_PRODUCTS_PER_BOARD_IN_PROMPT]:
                    board_lines.append(f"  - #{p['product_id']} {p['name']} ({p['shop_name'] or 'unknown shop'})")
        sections.append("### Boards\n" + "\n".join(board_lines))

    if pref_block:
        sections.append("### Preferences\n" + pref_block)
    if legacy_prefs:
        pref_lines = [f"- {k}: {legacy_prefs[k]}" for k in ("sizes", "budget", "likes", "dislikes") if k in legacy_prefs]
        sections.append("### Legacy preferences (free-text)\n" + "\n".join(pref_lines))
    if other:
        other_lines = [f"- {k}: {v}" for k, v in other]
        sections.append("### Other remembered facts\n" + "\n".join(other_lines))

    body = "\n\n".join(sections)
    # User-controlled content — wrap so the model treats it as data, not instructions.
    return "## What Mason remembers about this user\n" + wrap_untrusted(body, label="user_memory")


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

    # Prose lifestyle profile composed from image selections — show first if present
    ls_top = p.get("lifestyle") or {}
    profile_text = ls_top.get("profile_text", "")
    if profile_text:
        lines.append(f"Profile: {profile_text}")

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

async def list_saved_products(
    user_id: int,
    db: AsyncSession,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    from db.models import Shop, ProductVariant
    limit = max(1, min(limit, MAX_SAVED_PRODUCTS))
    offset = max(0, offset)
    result = await db.execute(
        select(SavedProduct, Product, Shop.name.label("shop_name"))
        .join(Product, Product.id == SavedProduct.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(SavedProduct.user_id == user_id)
        .order_by(SavedProduct.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = result.all()
    pids = [p.id for _, p, _ in rows]
    variants_by_pid: dict[int, list[ProductVariant]] = {}
    if pids:
        v_result = await db.execute(
            select(ProductVariant)
            .where(ProductVariant.product_id.in_(pids))
            .order_by(ProductVariant.variant_index)
        )
        for v in v_result.scalars().all():
            variants_by_pid.setdefault(v.product_id, []).append(v)
    out = []
    for saved, product, shop_name in rows:
        variants = variants_by_pid.get(product.id, [])
        default = next((v for v in variants if v.id == product.default_variant_id), None) or (variants[0] if variants else None)
        price = float(default.price) if default and default.price is not None else 0.0
        quantity = (default.quantity if default else 0) or 0
        image_url = default.image_url if default else None
        out.append({
            "product_id": product.id,
            "name": product.name,
            "price": price,
            "quantity": quantity,
            "image_url": image_url,
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
    count = (await db.execute(
        select(func.count(SavedProduct.id)).where(SavedProduct.user_id == user_id)
    )).scalar() or 0
    if count >= MAX_SAVED_PRODUCTS:
        raise ValueError(
            f"saved products limit reached ({MAX_SAVED_PRODUCTS}); remove some before saving more"
        )
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


# ── Boards ──────────────────────────────────────────────────────────────────

async def list_boards(user_id: int, db: AsyncSession) -> list[dict]:
    """Return all boards for a user with note/product counts (no heavy data)."""
    result = await db.execute(
        select(Board).where(Board.user_id == user_id).order_by(Board.created_at.asc())
    )
    boards = result.scalars().all()
    out = []
    for b in boards:
        note_count = (await db.execute(
            select(func.count(BoardNote.id)).where(BoardNote.board_id == b.id)
        )).scalar() or 0
        product_count = (await db.execute(
            select(func.count(BoardProduct.id)).where(BoardProduct.board_id == b.id)
        )).scalar() or 0
        first_product_image = (await db.execute(
            select(ProductVariant.image_url)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(BoardProduct, BoardProduct.product_id == Product.id)
            .where(BoardProduct.board_id == b.id)
            .where(ProductVariant.id == Product.default_variant_id)
            .order_by(BoardProduct.saved_at.asc())
            .limit(1)
        )).scalar()
        out.append({
            "id": b.id,
            "name": b.name,
            "description": b.description,
            "cover_image_url": b.cover_image_url,
            "first_product_image_url": first_product_image,
            "is_default": b.is_default,
            "note_count": note_count,
            "product_count": product_count,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "updated_at": b.updated_at.isoformat() if b.updated_at else None,
        })
    return out


async def get_board(user_id: int, board_id: int, db: AsyncSession) -> dict | None:
    """Return a board with its notes and products."""
    from db.models import Shop, ProductVariant
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )
    board = result.scalars().first()
    if not board:
        return None

    notes_result = await db.execute(
        select(BoardNote).where(BoardNote.board_id == board_id).order_by(BoardNote.created_at.asc())
    )
    notes = [
        {"id": n.id, "text": n.text, "created_at": n.created_at.isoformat() if n.created_at else None}
        for n in notes_result.scalars().all()
    ]

    products_result = await db.execute(
        select(BoardProduct, Product, Shop.name.label("shop_name"))
        .join(Product, Product.id == BoardProduct.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(BoardProduct.board_id == board_id)
        .order_by(BoardProduct.saved_at.desc())
    )
    rows = products_result.all()
    pids = [p.id for _, p, _ in rows]
    variants_by_pid: dict[int, list] = {}
    if pids:
        v_result = await db.execute(
            select(ProductVariant).where(ProductVariant.product_id.in_(pids)).order_by(ProductVariant.variant_index)
        )
        for v in v_result.scalars().all():
            variants_by_pid.setdefault(v.product_id, []).append(v)

    products = []
    for bp, product, shop_name in rows:
        variants = variants_by_pid.get(product.id, [])
        default = next((v for v in variants if v.id == product.default_variant_id), None) or (variants[0] if variants else None)
        products.append({
            "product_id": product.id,
            "name": product.name,
            "price": float(default.price) if default and default.price is not None else 0.0,
            "quantity": (default.quantity if default else 0) or 0,
            "image_url": default.image_url if default else None,
            "shop_id": product.shop_id,
            "shop_name": shop_name,
            "saved_at": bp.saved_at.isoformat() if bp.saved_at else None,
        })

    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "cover_image_url": board.cover_image_url,
        "is_default": board.is_default,
        "notes": notes,
        "products": products,
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "updated_at": board.updated_at.isoformat() if board.updated_at else None,
    }


async def create_board(user_id: int, name: str, description: str | None, db: AsyncSession) -> dict:
    """Create a new board. Raises ValueError if name already exists or cap reached."""
    name = (name or "").strip()[:200]
    if not name:
        raise ValueError("board name required")

    # Redirect to the protected default board rather than creating a duplicate
    if name.lower() == "my board":
        return await get_or_create_default_board(user_id, db)

    count = (await db.execute(
        select(func.count(Board.id)).where(Board.user_id == user_id)
    )).scalar() or 0
    if count >= MAX_BOARDS:
        raise ValueError(f"board limit reached ({MAX_BOARDS})")

    existing = (await db.execute(
        select(Board).where(Board.user_id == user_id, func.lower(Board.name) == name.lower())
    )).scalars().first()
    if existing:
        return {
            "id": existing.id,
            "name": existing.name,
            "description": existing.description,
            "cover_image_url": existing.cover_image_url,
            "is_default": existing.is_default,
            "note_count": 0,
            "product_count": 0,
            "created_at": existing.created_at.isoformat() if existing.created_at else None,
            "updated_at": existing.updated_at.isoformat() if existing.updated_at else None,
        }

    board = Board(user_id=user_id, name=name, description=description)
    db.add(board)
    await db.flush()
    await db.refresh(board)
    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "cover_image_url": board.cover_image_url,
        "is_default": board.is_default,
        "note_count": 0,
        "product_count": 0,
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "updated_at": board.updated_at.isoformat() if board.updated_at else None,
    }


async def update_board(user_id: int, board_id: int, patch: dict, db: AsyncSession) -> dict | None:
    """Patch board name/description. Returns updated board summary or None."""
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )
    board = result.scalars().first()
    if not board:
        return None
    if "name" in patch and patch["name"]:
        new_name = str(patch["name"]).strip()
        if board.is_default and new_name.lower() != "my board":
            raise ValueError("cannot rename 'My Board'")
        board.name = new_name[:200]
    if "description" in patch:
        board.description = patch["description"]
    if "cover_image_url" in patch:
        board.cover_image_url = patch["cover_image_url"]
    await db.flush()
    await db.refresh(board)
    note_count = (await db.execute(
        select(func.count(BoardNote.id)).where(BoardNote.board_id == board.id)
    )).scalar() or 0
    product_count = (await db.execute(
        select(func.count(BoardProduct.id)).where(BoardProduct.board_id == board.id)
    )).scalar() or 0
    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "cover_image_url": board.cover_image_url,
        "is_default": board.is_default,
        "note_count": note_count,
        "product_count": product_count,
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "updated_at": board.updated_at.isoformat() if board.updated_at else None,
    }


async def delete_board(user_id: int, board_id: int, db: AsyncSession) -> bool:
    result = await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )
    board = result.scalars().first()
    if not board:
        return False
    if board.is_default:
        raise ValueError("cannot delete the default 'My Board'")
    await db.delete(board)
    await db.flush()
    return True


async def save_product_to_board(user_id: int, board_id: int, product_id: int, db: AsyncSession) -> bool:
    """Save a product to a board. Returns True if newly saved."""
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if not board:
        raise ValueError(f"board {board_id} not found")

    product = (await db.execute(select(Product).where(Product.id == product_id))).scalars().first()
    if not product:
        raise ValueError(f"product {product_id} not found")

    existing = (await db.execute(
        select(BoardProduct).where(BoardProduct.board_id == board_id, BoardProduct.product_id == product_id)
    )).scalars().first()
    if existing:
        return False

    db.add(BoardProduct(board_id=board_id, product_id=product_id))
    await db.flush()
    return True


async def remove_product_from_board(user_id: int, board_id: int, product_id: int, db: AsyncSession) -> bool:
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if not board:
        return False
    row = (await db.execute(
        select(BoardProduct).where(BoardProduct.board_id == board_id, BoardProduct.product_id == product_id)
    )).scalars().first()
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def add_note_to_board(user_id: int, board_id: int | None, text: str, db: AsyncSession) -> dict:
    if board_id is None:
        default = await get_or_create_default_board(user_id, db)
        board_id = default["id"]
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if not board:
        raise ValueError(f"board {board_id} not found")

    text = (text or "").strip()[:MAX_BOARD_NOTE_CHARS]
    if not text:
        raise ValueError("empty note")

    existing = (await db.execute(
        select(BoardNote).where(
            BoardNote.board_id == board_id,
            func.lower(func.trim(BoardNote.text)) == text.lower(),
        ).limit(1)
    )).scalars().first()
    if existing:
        return {"id": existing.id, "board_id": board_id, "text": existing.text,
                "created_at": existing.created_at.isoformat() if existing.created_at else None}

    note = BoardNote(board_id=board_id, text=text)
    db.add(note)
    await db.flush()
    await db.refresh(note)
    return {"id": note.id, "board_id": board_id, "text": note.text,
            "created_at": note.created_at.isoformat() if note.created_at else None}


async def delete_board_note(user_id: int, board_id: int, note_id: int, db: AsyncSession) -> bool:
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if not board:
        return False
    row = (await db.execute(
        select(BoardNote).where(BoardNote.id == note_id, BoardNote.board_id == board_id)
    )).scalars().first()
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def get_or_create_default_board(user_id: int, db: AsyncSession) -> dict:
    """Return the user's is_default board, creating 'My Board' (with migration) if none exist."""
    existing_default = (await db.execute(
        select(Board).where(Board.user_id == user_id, Board.is_default == True)  # noqa: E712
    )).scalars().first()
    if existing_default:
        note_count = (await db.execute(
            select(func.count(BoardNote.id)).where(BoardNote.board_id == existing_default.id)
        )).scalar() or 0
        product_count = (await db.execute(
            select(func.count(BoardProduct.id)).where(BoardProduct.board_id == existing_default.id)
        )).scalar() or 0
        return {
            "id": existing_default.id,
            "name": existing_default.name,
            "description": existing_default.description,
            "cover_image_url": existing_default.cover_image_url,
            "is_default": True,
            "note_count": note_count,
            "product_count": product_count,
            "created_at": existing_default.created_at.isoformat() if existing_default.created_at else None,
            "updated_at": existing_default.updated_at.isoformat() if existing_default.updated_at else None,
        }

    board = Board(user_id=user_id, name="My Board", description="Your saved items", is_default=True)
    db.add(board)
    await db.flush()
    await db.refresh(board)

    # Migrate existing SavedProduct rows
    existing_saved = (await db.execute(
        select(SavedProduct).where(SavedProduct.user_id == user_id)
    )).scalars().all()
    for sp in existing_saved:
        db.add(BoardProduct(board_id=board.id, product_id=sp.product_id))
    if existing_saved:
        await db.flush()

    # Migrate existing UserMemory note rows into My Board
    existing_notes = (await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.key.like(f"{NOTE_KEY_PREFIX}%"),
        )
    )).scalars().all()
    for m in existing_notes:
        text = _note_text(m.value)[:MAX_BOARD_NOTE_CHARS]
        if text:
            db.add(BoardNote(board_id=board.id, text=text))
    if existing_notes:
        await db.flush()

    return {
        "id": board.id,
        "name": board.name,
        "description": board.description,
        "cover_image_url": board.cover_image_url,
        "is_default": True,
        "note_count": len(existing_notes),
        "product_count": len(existing_saved),
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "updated_at": board.updated_at.isoformat() if board.updated_at else None,
    }


async def find_board_by_name(user_id: int, name: str, db: AsyncSession) -> dict | None:
    """Look up a board by name (case-insensitive)."""
    result = (await db.execute(
        select(Board).where(Board.user_id == user_id, func.lower(Board.name) == name.lower().strip())
    )).scalars().first()
    if not result:
        return None
    return {"id": result.id, "name": result.name, "description": result.description}


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


# ── Shipping address ────────────────────────────────────────────────────────

SHIPPING_KEY = "shipping:address"

EMPTY_SHIPPING: dict = {
    "name": "",
    "line1": "",
    "line2": "",
    "city": "",
    "state": "",
    "postal_code": "",
    "country": "",
    "phone": "",
}

_SHIPPING_FIELDS = set(EMPTY_SHIPPING.keys())


async def get_shipping(user_id: int, db: AsyncSession) -> dict:
    result = await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id, UserMemory.key == SHIPPING_KEY,
        )
    )
    row = result.scalars().first()
    if not row or not isinstance(row.value, dict):
        return dict(EMPTY_SHIPPING)
    return {k: str(row.value.get(k) or "") for k in _SHIPPING_FIELDS}


async def set_shipping(user_id: int, patch: dict, db: AsyncSession) -> dict:
    if not isinstance(patch, dict):
        patch = {}
    result = await db.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id, UserMemory.key == SHIPPING_KEY,
        )
    )
    row = result.scalars().first()
    current = dict(row.value) if row and isinstance(row.value, dict) else {}
    for k, v in patch.items():
        if k not in _SHIPPING_FIELDS:
            continue
        current[k] = "" if v is None else str(v).strip()[:200]
    merged = {k: str(current.get(k) or "") for k in _SHIPPING_FIELDS}
    if row:
        row.value = merged
    else:
        await _evict_if_full(user_id, db)
        db.add(UserMemory(user_id=user_id, key=SHIPPING_KEY, value=merged))
    await db.flush()
    return merged


# ── Board Vibes ──────────────────────────────────────────────────────────────

async def add_vibe_to_board(
    user_id: int,
    board_id: int,
    label: str,
    image_url: str,
    source: str = "mason",
    db: AsyncSession = None,
) -> dict:
    """Save an inspo vibe to a board."""
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if board is None:
        raise ValueError(f"Board {board_id} not found")
    vibe = BoardVibe(
        board_id=board_id,
        label=label[:200],
        image_url=image_url,
        source=source,
    )
    db.add(vibe)
    await db.commit()
    await db.refresh(vibe)
    return {
        "id": vibe.id,
        "label": vibe.label,
        "image_url": vibe.image_url,
        "source": vibe.source,
        "created_at": vibe.created_at.isoformat() if vibe.created_at else None,
    }


async def get_board_vibes(user_id: int, board_id: int, db: AsyncSession) -> list:
    from sqlalchemy import asc
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if board is None:
        return []
    rows = (await db.execute(
        select(BoardVibe).where(BoardVibe.board_id == board_id).order_by(asc(BoardVibe.created_at))
    )).scalars().all()
    return [
        {
            "id": v.id,
            "label": v.label,
            "image_url": v.image_url,
            "source": v.source,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in rows
    ]


async def delete_board_vibe(user_id: int, board_id: int, vibe_id: int, db: AsyncSession) -> None:
    board = (await db.execute(
        select(Board).where(Board.id == board_id, Board.user_id == user_id)
    )).scalars().first()
    if board is None:
        raise ValueError("Board not found")
    vibe = (await db.execute(
        select(BoardVibe).where(BoardVibe.id == vibe_id, BoardVibe.board_id == board_id)
    )).scalars().first()
    if vibe:
        await db.delete(vibe)
        await db.commit()


# ── Admin Vibe Sets ──────────────────────────────────────────────────────────

async def list_vibe_sets(db: AsyncSession, active_only: bool = False) -> list:
    from sqlalchemy.orm import selectinload
    q = select(VibeSet).options(selectinload(VibeSet.vibes))
    if active_only:
        q = q.where(VibeSet.is_active == True)  # noqa: E712
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": vs.id,
            "name": vs.name,
            "description": vs.description,
            "is_active": vs.is_active,
            "vibes": [
                {"id": item.id, "label": item.label, "image_url": item.image_url, "sort_order": item.sort_order}
                for item in vs.vibes
            ],
        }
        for vs in rows
    ]


async def create_vibe_set(name: str, description: str | None, db: AsyncSession) -> dict:
    vs = VibeSet(name=name, description=description)
    db.add(vs)
    await db.commit()
    await db.refresh(vs)
    return {"id": vs.id, "name": vs.name, "description": vs.description, "is_active": vs.is_active, "vibes": []}


async def add_vibe_to_set(vibe_set_id: int, label: str, image_url: str, sort_order: int, db: AsyncSession) -> dict:
    item = VibeSetItem(vibe_set_id=vibe_set_id, label=label, image_url=image_url, sort_order=sort_order)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"id": item.id, "label": item.label, "image_url": item.image_url, "sort_order": item.sort_order}


async def delete_vibe_set_item(vibe_set_id: int, item_id: int, db: AsyncSession) -> None:
    item = (await db.execute(
        select(VibeSetItem).where(VibeSetItem.id == item_id, VibeSetItem.vibe_set_id == vibe_set_id)
    )).scalars().first()
    if item:
        await db.delete(item)
        await db.commit()


async def get_active_vibe_set(db: AsyncSession) -> dict | None:
    """Get the most recently created active vibe set for Mason to use."""
    from sqlalchemy.orm import selectinload
    vs = (await db.execute(
        select(VibeSet)
        .options(selectinload(VibeSet.vibes))
        .where(VibeSet.is_active == True)  # noqa: E712
        .order_by(VibeSet.created_at.desc())
        .limit(1)
    )).scalars().first()
    if vs is None:
        return None
    return {
        "id": vs.id,
        "name": vs.name,
        "vibes": [{"id": item.id, "label": item.label, "image_url": item.image_url} for item in vs.vibes],
    }
