"""Tool definitions (schemas for Claude) and tool execution logic."""
import json
from typing import Any
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from db.models import Product, Shop, AgentPlan, UserMemory
from db.schemas import ProductOut, ShopOut
from agent.memory import save_preference

# ── Tool schemas passed to Claude ────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "search_products",
        "description": (
            "Search products in the database. Returns a list of matching products. "
            "Use this before building product cards. Supports full-text search and filters."
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
    {
        "name": "build_product_card",
        "description": (
            "Render a product as a rich UI card artifact. Call this after search_products "
            "to display products to the user. Pass the full product data."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id", "name", "price", "shop_name"],
            "properties": {
                "product_id": {"type": "integer"},
                "name": {"type": "string"},
                "price": {"type": "number"},
                "quantity": {"type": "integer"},
                "image_url": {"type": "string"},
                "shop_name": {"type": "string"},
                "shop_id": {"type": "integer"},
                "description_summary": {"type": "string", "description": "Short 1-2 sentence summary"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    {
        "name": "build_shop_card",
        "description": "Render a shop as a UI card artifact to display to the user.",
        "input_schema": {
            "type": "object",
            "required": ["shop_id", "name"],
            "properties": {
                "shop_id": {"type": "integer"},
                "name": {"type": "string"},
                "logo_url": {"type": "string"},
                "description": {"type": "string"},
                "website_url": {"type": "string"},
                "product_count": {"type": "integer"},
            },
        },
    },
    {
        "name": "build_question_card",
        "description": (
            "Ask the user a clarifying question as an interactive UI card. "
            "Use when you need more information before searching (e.g., budget, size, preference). "
            "The user's answer will be sent back to you as a tool result."
        ),
        "input_schema": {
            "type": "object",
            "required": ["question_id", "question"],
            "properties": {
                "question_id": {"type": "string", "description": "Unique ID for this question, e.g. 'q_budget'"},
                "question": {"type": "string", "description": "The question to ask"},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional predefined choices. If omitted, free-text input shown.",
                },
                "hint": {"type": "string", "description": "Placeholder text for free-text input"},
            },
        },
    },
    {
        "name": "generate_plan",
        "description": (
            "Generate a numbered plan of steps before executing. Use for complex multi-step requests. "
            "The plan is shown to the user as a collapsible dropdown. "
            "After calling this, proceed to execute the steps."
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
    event_type is an optional streaming event hint (e.g. "artifact").
    """
    if tool_name == "search_products":
        return await _search_products(tool_input, db), None

    if tool_name == "search_shops":
        return await _search_shops(tool_input, db), None

    if tool_name in ("build_product_card", "build_shop_card", "build_question_card"):
        # These are purely UI artifacts — we echo the input back and flag as artifact
        return {"artifact": True, "kind": tool_name, "data": tool_input}, "artifact"

    if tool_name == "generate_plan":
        return await _generate_plan(tool_input, session_id, db), "plan_update"

    if tool_name == "save_preference":
        if user_id is None:
            return {"saved": False, "reason": "not_logged_in"}, None
        await save_preference(user_id, tool_input["key"], tool_input["value"], db)
        return {"saved": True, "key": tool_input["key"]}, None

    return {"error": f"Unknown tool: {tool_name}"}, None


async def _search_products(params: dict, db: AsyncSession) -> dict:
    from sqlalchemy import func as sqlfunc
    stmt = select(Product, Shop.name.label("shop_name")).join(Shop, Shop.id == Product.shop_id)

    q = params.get("query")
    if q:
        ts_query = sqlfunc.plainto_tsquery("english", q)
        stmt = stmt.where(Product.search_vector.op("@@")(ts_query))
        stmt = stmt.order_by(sqlfunc.ts_rank(Product.search_vector, ts_query).desc())
    else:
        stmt = stmt.order_by(Product.name)

    if params.get("shop_id"):
        stmt = stmt.where(Product.shop_id == params["shop_id"])
    if params.get("min_price") is not None:
        stmt = stmt.where(Product.price >= Decimal(str(params["min_price"])))
    if params.get("max_price") is not None:
        stmt = stmt.where(Product.price <= Decimal(str(params["max_price"])))
    if params.get("in_stock_only"):
        stmt = stmt.where(Product.quantity > 0)

    limit = min(int(params.get("limit", 10)), 20)
    stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    rows = result.all()
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
