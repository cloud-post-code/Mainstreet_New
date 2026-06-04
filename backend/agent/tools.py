"""Tool definitions (schemas for Claude) and tool execution logic."""
import logging
import traceback
from typing import Any
from decimal import Decimal

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text as sql_text, bindparam
from db.models import Product, Shop, AgentPlan
from agent.memory import save_preference
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
            "Save a user preference or fact to long-term memory. "
            "Use when the user mentions their size, budget, favorite brands, etc."
        ),
        "input_schema": {
            "type": "object",
            "required": ["key", "value"],
            "properties": {
                "key": {"type": "string", "description": "Memory key, e.g. 'preferred_budget', 'shoe_size', 'favorite_brand'"},
                "value": {"description": "The value to remember (string, number, or list)"},
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
            await save_preference(user_id, tool_input["key"], tool_input["value"], db)
            return {"saved": True, "key": tool_input["key"]}, None
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
