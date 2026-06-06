"""Tool definitions (schemas for Claude) and tool execution logic."""
import logging
import traceback
from typing import Any
from decimal import Decimal

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text as sql_text, bindparam
from db.models import Product, Shop, AgentPlan
from agent.memory import (
    save_preference,
    add_note as memory_add_note,
    save_product as memory_save_product,
    delete_note as memory_delete_note,
    list_notes as memory_list_notes,
    get_prefs as memory_get_prefs,
    set_prefs as memory_set_prefs,
    list_saved_products as memory_list_saved,
)
from db.models import AgentSession, InboxMessage
from agent.embeddings import (
    embed_texts,
    rewrite_query,
    reciprocal_rank_fusion,
    vector_literal,
)
from agent.a2ui_schema import (
    RENDER_UI_TOOL_SCHEMA,
    collect_product_card_ids,
    enrich_render_ui_payload,
    validate_render_ui,
)
from routers import cart as cart_service


async def _product_quantities_for_render_ui(payload: dict, db: AsyncSession) -> dict[int, int]:
    ids = collect_product_card_ids(payload)
    if not ids:
        return {}
    result = await db.execute(
        select(Product.id, Product.quantity).where(Product.id.in_(ids))
    )
    return {row.id: row.quantity for row in result.all()}

# ── Tool schemas passed to Claude ────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "search_products",
        "description": (
            "Search products in the database. Returns a list of matching products. "
            "Call this before render_ui whenever the UI will reference products. "
            "Supports full-text search and filters."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keywords (product name, tags, description)"},
                "shop_id": {"type": "integer", "description": "Filter to a specific shop ID"},
                "min_price": {"type": "number", "description": "Minimum price filter"},
                "max_price": {"type": "number", "description": "Maximum price filter"},
                "in_stock_only": {"type": "boolean", "description": "Only return in-stock products"},
                "limit": {"type": "integer", "description": "Max results (default 10, max 20)", "default": 10},
            },
        },
    },
    {
        "name": "search_shops",
        "description": "Search shops by name or category. Returns a list of matching shops.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Shop name or category to search for"},
            },
        },
    },
    RENDER_UI_TOOL_SCHEMA,
    {
        "name": "generate_plan",
        "description": (
            "Generate a numbered plan of steps before executing. Use for complex multi-step requests. "
            "The plan is shown to the user as a collapsible dropdown. "
            "After calling this, proceed to execute the steps and finish with render_ui."
        ),
        "input_schema": {
            "type": "object",
            "required": ["steps"],
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["step", "description"],
                        "properties": {
                            "step": {"type": "integer"},
                            "description": {"type": "string"},
                        },
                    },
                    "description": "Ordered list of steps the agent will take",
                },
            },
        },
    },
    {
        "name": "add_to_cart",
        "description": (
            "Add a product to the user's cart. If the product is already in the cart, "
            "the quantity is incremented. Resolve the product_id with search_products first "
            "if the user referenced the product by name."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id"],
            "properties": {
                "product_id": {"type": "integer", "description": "Product ID to add"},
                "quantity": {"type": "integer", "description": "How many to add (default 1)", "default": 1},
            },
        },
    },
    {
        "name": "view_cart",
        "description": "Return the contents of the current user's cart with names, prices, quantities, subtotals, and total.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "remove_from_cart",
        "description": "Remove a product from the current user's cart entirely.",
        "input_schema": {
            "type": "object",
            "required": ["product_id"],
            "properties": {
                "product_id": {"type": "integer", "description": "Product ID to remove"},
            },
        },
    },
    {
        "name": "checkout",
        "description": (
            "Generate a checkout link for the current cart and clear the cart. "
            "Returns an opaque checkout URL the user can follow to complete the order."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "save_preference",
        "description": (
            "Save a shopping preference for one of the four reserved keys so it shows up in the Prefs panel. "
            "Use this when the user states a durable shopping preference: clothing/shoe sizes, budget caps, "
            "brands or materials they love, or things they want to avoid. Prefer this over save_note for "
            "the four canonical fields."
        ),
        "input_schema": {
            "type": "object",
            "required": ["key", "value"],
            "properties": {
                "key": {
                    "type": "string",
                    "enum": ["pref:sizes", "pref:budget", "pref:likes", "pref:dislikes"],
                    "description": "Which preference field to update.",
                },
                "value": {"type": "string", "description": "Short value to remember (a phrase or short sentence)."},
            },
        },
    },
    {
        "name": "save_note",
        "description": (
            "Record a durable fact about the user as a Note so future conversations can use it. "
            "Use when the user reveals a lasting fact about themselves — where they live, who they "
            "shop for (kids, partner, pets), allergies, recurring needs, lifestyle, personality. "
            "Write the note in third person (\"Lives in the South End\", \"Shops for a 5yo daughter\"). "
            "Do NOT save: the current request, ephemeral context, or anything already in memory. "
            "One note per fact; keep it under 280 characters."
        ),
        "input_schema": {
            "type": "object",
            "required": ["text"],
            "properties": {
                "text": {"type": "string", "description": "A short third-person fact about the user."},
            },
        },
    },
    {
        "name": "save_product",
        "description": (
            "Save a product to the user's Saved list so they can find it later. Use when the user "
            "expresses lasting interest in a specific product (\"I love this\", \"save this for later\", "
            "\"add this to my list\", \"keep this in mind\"). Resolve the product_id with search_products "
            "first if they referenced it by name."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id"],
            "properties": {
                "product_id": {"type": "integer", "description": "Product ID to save."},
            },
        },
    },
]

# ── Mason memory-mode tool schemas ──────────────────────────────────────────
# Used on the /mason page chat. No shopping tools (no product search, cart,
# checkout, render_ui). Mason can read and write memory directly.

_SAVE_NOTE_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "save_note")
_SAVE_PREF_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "save_preference")

MASON_MEMORY_TOOL_DEFINITIONS = [
    _SAVE_NOTE_DEF,
    _SAVE_PREF_DEF,
    {
        "name": "delete_note",
        "description": (
            "Remove a note from the user's notes by its key. Use list_notes first "
            "to find the key. The key looks like 'note:<uuid>'."
        ),
        "input_schema": {
            "type": "object",
            "required": ["key"],
            "properties": {
                "key": {"type": "string", "description": "The note key to remove."},
            },
        },
    },
    {
        "name": "delete_preference",
        "description": (
            "Clear one of the four reserved preference fields. Use when the user "
            "asks you to forget a stated preference."
        ),
        "input_schema": {
            "type": "object",
            "required": ["key"],
            "properties": {
                "key": {
                    "type": "string",
                    "enum": ["pref:sizes", "pref:budget", "pref:likes", "pref:dislikes"],
                },
            },
        },
    },
    {
        "name": "list_notes",
        "description": "Return all of the user's notes (key + text + created_at), newest first.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_preferences",
        "description": "Return the four reserved preference fields (sizes, budget, likes, dislikes).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_saved_products",
        "description": "Return the user's saved products (id, name, price, shop, saved_at).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_history",
        "description": "Return the user's recent conversation sessions (id, title, updated_at). Default limit 10.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Max sessions to return (default 10, max 50)"},
            },
        },
    },
    {
        "name": "list_inbox",
        "description": "Return inbox messages for the user (id, title, preview, read, created_at).",
        "input_schema": {
            "type": "object",
            "properties": {
                "unread_only": {"type": "boolean", "description": "If true, return only unread messages."},
            },
        },
    },
]


# ── Tool execution ─────────────────────────────────────────────────────────

async def execute_tool(
    tool_name: str,
    tool_input: dict,
    user_id: int | None,
    session_id: int,
    db: AsyncSession,
) -> tuple[Any, str | None]:
    """
    Execute a tool and return (result_for_claude, event_type).
    result_for_claude is what gets sent back as tool_result content.
    event_type is an optional streaming event hint (e.g. "ui_tree").
    """
    try:
        if tool_name == "search_products":
            return await _search_products(tool_input, db), None
        if tool_name == "search_shops":
            return await _search_shops(tool_input, db), None
        if tool_name == "render_ui":
            errors = validate_render_ui(tool_input)
            if errors:
                return (
                    {
                        "render_ui_invalid": True,
                        "errors": errors,
                        "hint": "Fix the listed errors and call render_ui again in this same turn.",
                    },
                    None,
                )
            quantities = await _product_quantities_for_render_ui(tool_input, db)
            enriched = enrich_render_ui_payload(tool_input, quantities)
            return enriched, "ui_tree"
        if tool_name == "generate_plan":
            return await _generate_plan(tool_input, session_id, db), "plan_update"
        if tool_name == "save_preference":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            key = str(tool_input.get("key") or "")
            value = str(tool_input.get("value") or "").strip()
            if not value:
                return {"saved": False, "reason": "empty_value"}, None
            # Route the four legacy keys into the structured user_preferences row
            # so they show up in the rich Prefs panel.
            if key in {"pref:likes", "pref:dislikes"}:
                field = key.split(":", 1)[1]
                current = (await memory_get_prefs(user_id, db)).get(field) or []
                # split on commas so the agent can pass "leather, cotton"
                parts = [p.strip() for p in value.split(",") if p.strip()]
                merged = list(current)
                for p in parts:
                    if not any(p.lower() == x.lower() for x in merged):
                        merged.append(p)
                await memory_set_prefs(user_id, {field: merged}, db)
            elif key == "pref:budget":
                digits = "".join(ch for ch in value if ch.isdigit())
                patch: dict = {}
                if digits:
                    try:
                        patch["personal_budget"] = int(digits)
                    except ValueError:
                        pass
                patch["gift_budget"] = {"freeform": value[:200]}
                await memory_set_prefs(user_id, patch, db)
            elif key == "pref:sizes":
                await memory_set_prefs(user_id, {"sizes": {"freeform": value[:200]}}, db)
            else:
                # Fallback: still write through the legacy user_memory store.
                await save_preference(user_id, key, value, db)
            return {"saved": True, "key": key}, None
        if tool_name == "save_note":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            try:
                note = await memory_add_note(user_id, str(tool_input.get("text") or ""), db)
            except ValueError as ve:
                return {"saved": False, "reason": str(ve)}, None
            return {"saved": True, "key": note["key"], "text": note["text"]}, None
        if tool_name == "save_product":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            try:
                created = await memory_save_product(user_id, int(tool_input["product_id"]), db)
            except ValueError as ve:
                return {"saved": False, "reason": str(ve)}, None
            return {"saved": True, "product_id": int(tool_input["product_id"]), "newly_saved": created}, None
        if tool_name == "add_to_cart":
            return await cart_service.add_item(
                product_id=int(tool_input["product_id"]),
                quantity=int(tool_input.get("quantity") or 1),
                user_id=user_id,
                session_id=session_id,
                db=db,
            ), None
        if tool_name == "view_cart":
            return await cart_service.view(user_id, session_id, db), None
        if tool_name == "remove_from_cart":
            return await cart_service.remove_item(int(tool_input["product_id"]), user_id, session_id, db), None
        if tool_name == "checkout":
            return await cart_service.checkout(user_id, session_id, db), None
        if tool_name == "delete_note":
            if user_id is None:
                return {"deleted": False, "reason": "not_logged_in"}, None
            ok = await memory_delete_note(user_id, str(tool_input.get("key") or ""), db)
            return {"deleted": ok, "key": tool_input.get("key")}, None
        if tool_name == "delete_preference":
            if user_id is None:
                return {"deleted": False, "reason": "not_logged_in"}, None
            key = str(tool_input.get("key") or "")
            valid = {"pref:sizes", "pref:budget", "pref:likes", "pref:dislikes"}
            if key not in valid:
                return {"deleted": False, "reason": "invalid_key"}, None
            field = key.split(":", 1)[1]
            if field in {"likes", "dislikes"}:
                await memory_set_prefs(user_id, {field: []}, db)
            elif field == "sizes":
                await memory_set_prefs(user_id, {"sizes": None}, db)
            elif field == "budget":
                await memory_set_prefs(user_id, {"personal_budget": None, "gift_budget": None}, db)
            return {"deleted": True, "key": key}, None
        if tool_name == "list_notes":
            if user_id is None:
                return {"notes": [], "reason": "not_logged_in"}, None
            return {"notes": await memory_list_notes(user_id, db)}, None
        if tool_name == "list_preferences":
            if user_id is None:
                return {"prefs": {}, "reason": "not_logged_in"}, None
            return {"prefs": await memory_get_prefs(user_id, db)}, None
        if tool_name == "list_saved_products":
            if user_id is None:
                return {"saved_products": [], "reason": "not_logged_in"}, None
            return {"saved_products": await memory_list_saved(user_id, db)}, None
        if tool_name == "list_history":
            if user_id is None:
                return {"sessions": [], "reason": "not_logged_in"}, None
            limit = min(int(tool_input.get("limit") or 10), 50)
            rows = (await db.execute(
                select(AgentSession)
                .where(AgentSession.user_id == user_id)
                .order_by(AgentSession.updated_at.desc())
                .limit(limit)
            )).scalars().all()
            return {"sessions": [
                {
                    "id": r.id,
                    "title": r.title,
                    "session_type": getattr(r, "session_type", "shop"),
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                }
                for r in rows
            ]}, None
        if tool_name == "list_inbox":
            if user_id is None:
                return {"messages": [], "reason": "not_logged_in"}, None
            stmt = select(InboxMessage).where(InboxMessage.user_id == user_id)
            if tool_input.get("unread_only"):
                stmt = stmt.where(InboxMessage.read.is_(False))
            stmt = stmt.order_by(InboxMessage.created_at.desc()).limit(50)
            rows = (await db.execute(stmt)).scalars().all()
            return {"messages": [
                {
                    "id": r.id,
                    "title": r.title,
                    "preview": r.preview,
                    "read": r.read,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]}, None
        return {"error": f"Unknown tool: {tool_name}"}, None
    except Exception as e:
        logger.exception("Tool %s failed with input %s", tool_name, tool_input)
        return (
            {
                "error": f"{type(e).__name__}: {e}",
                "tool": tool_name,
                "traceback": traceback.format_exc(),
            },
            None,
        )


_HYBRID_SQL = sql_text("""
WITH lex AS (
    SELECT id,
           row_number() OVER (ORDER BY ts_rank(search_vector, q) DESC) AS rank
    FROM products, websearch_to_tsquery('english', :q) q
    WHERE search_vector @@ q OR name % :q
    LIMIT 50
),
sem AS (
    SELECT id,
           row_number() OVER (ORDER BY embedding <=> CAST(:qvec AS vector)) AS rank
    FROM products
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> CAST(:qvec AS vector)
    LIMIT 50
)
SELECT 'lex' AS src, id, rank FROM lex
UNION ALL
SELECT 'sem' AS src, id, rank FROM sem
""")

_LEX_ONLY_SQL = sql_text("""
SELECT id,
       row_number() OVER (ORDER BY ts_rank(search_vector, q) DESC) AS rank
FROM products, websearch_to_tsquery('english', :q) q
WHERE search_vector @@ q OR name % :q
LIMIT 50
""")


async def _search_products(params: dict, db: AsyncSession) -> dict:
    from sqlalchemy import func as sqlfunc
    limit = min(int(params.get("limit", 10)), 20)

    q = (params.get("query") or "").strip()

    # No query: keep the simple alphabetical browse path.
    if not q:
        stmt = (
            select(Product, Shop.name.label("shop_name"))
            .join(Shop, Shop.id == Product.shop_id)
            .order_by(Product.name)
        )
        stmt = _apply_filters(stmt, params)
        result = await db.execute(stmt.limit(limit))
        return _format_results(result.all())

    # Rung 4: 3 query variants (literal / synonyms / product-type).
    variants = await rewrite_query(q)
    if not variants:
        variants = [q]

    # Rung 2: embed variants. Empty list / all-None means no semantic branch.
    vectors = await embed_texts(variants)

    # Per-variant hybrid CTE → ranked id lists for RRF.
    ranked_lists: list[list[int]] = []
    for variant, vec in zip(variants, vectors):
        if vec is not None:
            rows = (await db.execute(
                _HYBRID_SQL, {"q": variant, "qvec": vector_literal(vec)},
            )).all()
        else:
            rows = [("lex", *r) for r in (await db.execute(
                _LEX_ONLY_SQL, {"q": variant},
            )).all()]
        lex_ranked: list[tuple[int, int]] = []
        sem_ranked: list[tuple[int, int]] = []
        for row in rows:
            src, pid, rank = row[0], int(row[1]), int(row[2])
            if src == "sem":
                sem_ranked.append((pid, rank))
            else:
                lex_ranked.append((pid, rank))
        lex_ranked.sort(key=lambda x: x[1])
        sem_ranked.sort(key=lambda x: x[1])
        if lex_ranked:
            ranked_lists.append([pid for pid, _ in lex_ranked])
        if sem_ranked:
            ranked_lists.append([pid for pid, _ in sem_ranked])

    if not ranked_lists:
        return {"count": 0, "products": []}

    fused = reciprocal_rank_fusion(ranked_lists)
    fused_ids = [pid for pid, _ in fused]

    # Hydrate + apply filters. Pull more than `limit` so filters don't
    # starve the result set; cap to the fused candidate pool.
    hydrate_stmt = (
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .where(Product.id.in_(fused_ids))
    )
    hydrate_stmt = _apply_filters(hydrate_stmt, params)
    rows = (await db.execute(hydrate_stmt)).all()
    by_id = {p.id: (p, sn) for p, sn in rows}

    ordered = []
    for pid in fused_ids:
        hit = by_id.get(pid)
        if hit is not None:
            ordered.append(hit)
            if len(ordered) >= limit:
                break

    return _format_results(ordered)


def _apply_filters(stmt, params: dict):
    if params.get("shop_id"):
        stmt = stmt.where(Product.shop_id == params["shop_id"])
    if params.get("min_price") is not None:
        stmt = stmt.where(Product.price >= Decimal(str(params["min_price"])))
    if params.get("max_price") is not None:
        stmt = stmt.where(Product.price <= Decimal(str(params["max_price"])))
    if params.get("in_stock_only"):
        stmt = stmt.where(Product.quantity > 0)
    return stmt


def _format_results(rows) -> dict:
    products = []
    for product, shop_name in rows:
        products.append({
            "product_id": product.id,
            "name": product.name,
            "price": float(product.price),
            "quantity": product.quantity,
            "image_url": product.image_url,
            "shop_name": shop_name,
            "shop_id": product.shop_id,
            "description_summary": (product.description or {}).get("summary", "")[:200],
            "tags": (product.description or {}).get("tags", []),
        })
    return {"count": len(products), "products": products}


async def _search_shops(params: dict, db: AsyncSession) -> dict:
    q = params.get("query", "")
    stmt = (
        select(Shop, func.count(Product.id).label("product_count"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
    )
    if q:
        stmt = stmt.where(Shop.name.ilike(f"%{q}%") | Shop.description.ilike(f"%{q}%"))

    result = await db.execute(stmt)
    rows = result.all()
    shops = []
    for shop, count in rows:
        shops.append({
            "shop_id": shop.id,
            "name": shop.name,
            "logo_url": shop.logo_url,
            "description": shop.description,
            "website_url": shop.website_url,
            "product_count": count,
        })
    return {"count": len(shops), "shops": shops}


async def _generate_plan(params: dict, session_id: int, db: AsyncSession) -> dict:
    steps = [{"step": s["step"], "description": s["description"], "done": False} for s in params["steps"]]

    result = await db.execute(
        select(AgentPlan).where(AgentPlan.session_id == session_id).order_by(AgentPlan.created_at.desc()).limit(1)
    )
    existing = result.scalars().first()
    if existing:
        existing.steps = steps
    else:
        db.add(AgentPlan(session_id=session_id, steps=steps))
    await db.flush()
    return {"plan_saved": True, "steps": steps}
