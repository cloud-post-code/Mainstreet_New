"""Tool definitions (schemas for Claude) and tool execution logic."""
import logging
import traceback
from typing import Any
from decimal import Decimal

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text as sql_text, bindparam
from db.models import Product, ProductVariant, Shop, AgentPlan
from agent.memory import (
    save_preference,
    save_product as memory_save_product,
    get_prefs as memory_get_prefs,
    set_prefs as memory_set_prefs,
    list_saved_products as memory_list_saved,
    list_boards as memory_list_boards,
    get_board as memory_get_board,
    create_board as memory_create_board,
    save_product_to_board as memory_save_product_to_board,
    add_note_to_board as memory_add_note_to_board,
    get_or_create_default_board as memory_get_or_create_default_board,
    find_board_by_name as memory_find_board_by_name,
)
from db.models import AgentSession, InboxMessage
from agent.embeddings import (
    embed_texts,
    rewrite_query,
    reciprocal_rank_fusion,
    vector_literal,
)
from agent.reranker import rerank as _zerank_rerank, RerankerError
from config import settings as _settings
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
    # Sum variant quantity per parent so the in_stock badge reflects total
    # availability across all variant choices.
    result = await db.execute(
        select(ProductVariant.product_id, func.coalesce(func.sum(ProductVariant.quantity), 0))
        .where(ProductVariant.product_id.in_(ids))
        .group_by(ProductVariant.product_id)
    )
    return {row[0]: int(row[1] or 0) for row in result.all()}


async def _product_variants_for_render_ui(
    payload: dict, db: AsyncSession
) -> tuple[dict[int, list[dict]], dict[int, int | None]]:
    """Fetch the full variant list + default variant id for every product_card
    in the payload so the frontend can always render option chips, even when
    the agent omitted variants from its render_ui call."""
    ids = collect_product_card_ids(payload)
    if not ids:
        return {}, {}
    v_result = await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id.in_(ids))
        .order_by(ProductVariant.variant_index)
    )
    variants_by_pid: dict[int, list[dict]] = {}
    for v in v_result.scalars().all():
        variants_by_pid.setdefault(v.product_id, []).append(_variant_summary(v))
    default_result = await db.execute(
        select(Product.id, Product.default_variant_id).where(Product.id.in_(ids))
    )
    default_by_pid: dict[int, int | None] = {row[0]: row[1] for row in default_result.all()}
    return variants_by_pid, default_by_pid

# ── Tool schemas passed to Claude ────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "search_products",
        "description": (
            "Search parent products in the database. Each result is a single product "
            "with its full list of variants (colors, sizes, etc.). Use the variants array "
            "to decide whether to show a parent card with a dropdown, or pin a single variant. "
            "Call this before render_ui whenever the UI will reference products."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keywords (product name, tags, option values like 'red', 'large')"},
                "shop_id": {"type": "integer", "description": "Filter to a specific shop ID"},
                "min_price": {"type": "number", "description": "Minimum price filter (matches any variant)"},
                "max_price": {"type": "number", "description": "Maximum price filter (matches any variant)"},
                "in_stock_only": {"type": "boolean", "description": "Only return products with at least one in-stock variant"},
                "limit": {"type": "integer", "description": "Max results (default 10, max 20)", "default": 10},
            },
        },
    },
    {
        "name": "show_product",
        "description": (
            "Decide how a single product is rendered in the UI. Use display_mode='parent' "
            "to show the parent card with a dropdown of variants (best when the shopper "
            "hasn't picked a specific option). Use display_mode='variant' to show a single "
            "fixed variant card (best when the shopper named a specific color/size/style). "
            "Optionally pass preselected_variant_id to land the dropdown on a specific option "
            "in parent mode."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id", "display_mode"],
            "properties": {
                "product_id": {"type": "integer", "description": "Parent product ID"},
                "display_mode": {
                    "type": "string",
                    "enum": ["parent", "variant"],
                    "description": "parent = card with variant dropdown; variant = single pinned variant",
                },
                "preselected_variant_id": {
                    "type": "integer",
                    "description": "Variant to start the dropdown on (parent mode) or to pin (variant mode)",
                },
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
            "Add a specific variant to the user's cart. variant_id is REQUIRED whenever the "
            "product has more than one variant — the cart will reject the call with "
            "reason='variant_required' if you pass only product_id for a multi-variant product. "
            "Use product_id alone only for products with a single variant. Resolve ids via "
            "search_products first, and when the shopper hasn't named an option yet, ask them "
            "to pick one (render a product_card with the variants array) instead of guessing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "variant_id": {"type": "integer", "description": "Variant ID to add (preferred)"},
                "product_id": {"type": "integer", "description": "Product ID — falls back to the default variant"},
                "quantity": {"type": "integer", "description": "How many to add (default 1)", "default": 1},
            },
        },
    },
    {
        "name": "view_cart",
        "description": "Return the contents of the current user's cart with variant labels, prices, quantities, subtotals, and total.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "remove_from_cart",
        "description": "Remove a variant from the current user's cart entirely.",
        "input_schema": {
            "type": "object",
            "required": ["variant_id"],
            "properties": {
                "variant_id": {"type": "integer", "description": "Variant ID to remove"},
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
            "brands or materials they love, or things they want to avoid. Prefer update_preferences over "
            "this for the four canonical fields."
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
        "name": "update_preferences",
        "description": (
            "Save or update the user's structured preferences profile. Use this proactively "
            "whenever the conversation reveals something durable about the user's style, sizes, "
            "budget, lifestyle, likes, or dislikes. Always tell the user what you are saving "
            "(e.g. 'I've noted your shoe size — saving that to your profile'). "
            "Accepts a partial patch — only include fields you want to update. "
            "JSONB fields (sizes, lifestyle, gift_budget) are shallow-merged; "
            "arrays (style_tags, likes, dislikes) REPLACE the existing list so call "
            "list_preferences first when you need to append. Prefer this over save_preference."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "style_tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Aesthetic style tags (e.g. ['minimalist', 'classic']). Replaces existing list.",
                },
                "likes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Brands, materials, or things the user likes. Replaces existing list.",
                },
                "dislikes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Things to avoid. Replaces existing list.",
                },
                "personal_budget": {
                    "type": "integer",
                    "description": "Typical per-item or monthly personal shopping budget in dollars.",
                },
                "sizes": {
                    "type": "object",
                    "description": "Clothing/shoe sizes. Shallow-merged. Keys: shirt, waist, inseam, shoe, dress, hat, ring, freeform.",
                    "properties": {
                        "shirt":   {"type": "string"},
                        "waist":   {"type": "string"},
                        "inseam":  {"type": "string"},
                        "shoe":    {"type": "string"},
                        "dress":   {"type": "string"},
                        "hat":     {"type": "string"},
                        "ring":    {"type": "string"},
                        "freeform": {"type": "string"},
                    },
                },
                "gift_budget": {
                    "type": "object",
                    "description": "Gift budget per occasion. Shallow-merged. Keys: default, birthday, holiday, anniversary (integers, dollars), freeform (string).",
                    "properties": {
                        "default":     {"type": "integer"},
                        "birthday":    {"type": "integer"},
                        "holiday":     {"type": "integer"},
                        "anniversary": {"type": "integer"},
                        "freeform":    {"type": "string"},
                    },
                },
                "lifestyle": {
                    "type": "object",
                    "description": (
                        "Lifestyle context. Shallow-merged. Keys: housing ('homeowner'|'renter'|'condo'), "
                        "area ('urban'|'suburban'|'rural'), work_env ('wfh'|'hybrid'|'office'|'outdoor'), "
                        "pets (string[]), pets_notes, hobbies (string[]), cooking ('rarely'|'sometimes'|'often'|'daily'), "
                        "travel ('rarely'|'few_times_year'|'monthly'|'frequently'), fitness (string[]), "
                        "family_notes, home_aesthetic, freeform_notes, color_palette (string[]), "
                        "weekend_vibes (string[]), shop_style."
                    ),
                },
                "quality_price": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": "Quality vs price slider: 1=budget-focused, 5=premium-first.",
                },
                "bulk_individual": {"type": "integer", "minimum": 1, "maximum": 5},
                "discover_known":  {"type": "integer", "minimum": 1, "maximum": 5},
            },
        },
    },
    {
        "name": "save_product",
        "description": (
            "Save a product to the user's default Saved board. Prefer save_to_board when you know "
            "which board the user wants. Use this as a fallback when no board context is available."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id"],
            "properties": {
                "product_id": {"type": "integer", "description": "Product ID to save."},
            },
        },
    },
    {
        "name": "list_boards",
        "description": (
            "Return all of the user's boards (id, name, description, note_count, product_count). "
            "Call this before save_to_board or save_note_to_board when you need to pick the right board."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_board",
        "description": (
            "Create a new board for the user. Use when the user starts a distinct new shopping context "
            "(a gift, a room, an occasion) that doesn't fit an existing board. "
            "Do not create duplicate boards — call list_boards first to check."
        ),
        "input_schema": {
            "type": "object",
            "required": ["name"],
            "properties": {
                "name": {"type": "string", "description": "Short board name, e.g. 'Mom's Birthday' or 'Living Room'"},
                "description": {"type": "string", "description": "Optional one-sentence purpose of the board"},
            },
        },
    },
    {
        "name": "save_to_board",
        "description": (
            "Save a product to a specific board. This is the preferred way to save products. "
            "If the user has no boards, 'My Board' is created automatically as the default. "
            "Provide board_id (preferred) or board_name to target a specific board. "
            "If context is ambiguous and the user has multiple boards, use ask_save_to_board instead."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id"],
            "properties": {
                "product_id": {"type": "integer", "description": "Product ID to save"},
                "board_id": {"type": "integer", "description": "Target board ID (preferred)"},
                "board_name": {"type": "string", "description": "Board name to look up (if board_id not known)"},
            },
        },
    },
    {
        "name": "save_note_to_board",
        "description": (
            "Save a durable note to a board. Use this for ALL durable note-saving — both "
            "user facts (size, pets, lifestyle) and contextual shopping notes. "
            "Omit board_id to save to 'My Board' (the default). Provide board_id when "
            "the note belongs to a specific board context. Do not ask the user which board — reason about it."
        ),
        "input_schema": {
            "type": "object",
            "required": ["text"],
            "properties": {
                "board_id": {"type": "integer", "description": "Board to attach the note to. Omit to save to My Board."},
                "text": {"type": "string", "description": "Note text, under 500 characters"},
            },
        },
    },
    {
        "name": "ask_save_to_board",
        "description": (
            "Render a board-picker card so the user can choose which board to save a product to. "
            "Use this instead of save_to_board when the user has multiple boards and context is too "
            "ambiguous to pick confidently. Do NOT use for notes — route those silently with save_note_to_board."
        ),
        "input_schema": {
            "type": "object",
            "required": ["product_id", "product_name"],
            "properties": {
                "product_id": {"type": "integer", "description": "Product ID to save"},
                "product_name": {"type": "string", "description": "Product name for display in the picker card"},
            },
        },
    },
]

# ── Fast Mason tool subset ──────────────────────────────────────────────────
# Smaller surface for the fast path. Drops search_shops, generate_plan,
# remove_from_cart, checkout — fast Mason handles single-product asks; cart
# management and checkout flow back through the full path.

_FAST_TOOL_NAMES = {
    "search_products",
    "show_product",
    "render_ui",
    "add_to_cart",
    "view_cart",
    "update_preferences",
    "save_preference",
    "save_product",
    "list_boards",
    "create_board",
    "save_to_board",
    "save_note_to_board",
    "ask_save_to_board",
}
FAST_TOOL_DEFINITIONS = [t for t in TOOL_DEFINITIONS if t["name"] in _FAST_TOOL_NAMES]


# ── Mason memory-mode tool schemas ──────────────────────────────────────────
# Used on the /mason page chat. No shopping tools (no product search, cart,
# checkout, render_ui). Mason can read and write memory directly.

_SAVE_PREF_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "save_preference")
_UPDATE_PREFS_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "update_preferences")
_LIST_BOARDS_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "list_boards")
_CREATE_BOARD_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "create_board")
_SAVE_NOTE_TO_BOARD_DEF = next(t for t in TOOL_DEFINITIONS if t["name"] == "save_note_to_board")

MASON_MEMORY_TOOL_DEFINITIONS = [
    _SAVE_PREF_DEF,
    _UPDATE_PREFS_DEF,
    _LIST_BOARDS_DEF,
    _CREATE_BOARD_DEF,
    _SAVE_NOTE_TO_BOARD_DEF,
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
        if tool_name == "show_product":
            return await _show_product(tool_input, db), None
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
            variants_by_pid, default_by_pid = await _product_variants_for_render_ui(tool_input, db)
            # Hard rule: every product_card whose product has more than one
            # variant must include the variants array. This forces the agent
            # to learn the contract instead of relying on silent enrichment.
            missing_variant_cards: list[dict] = []
            for comp in tool_input.get("components") or []:
                if not isinstance(comp, dict) or comp.get("type") != "product_card":
                    continue
                props = comp.get("props") or {}
                pid = props.get("product_id")
                if not isinstance(pid, int):
                    continue
                db_variants = variants_by_pid.get(pid, [])
                if len(db_variants) <= 1:
                    continue
                supplied = props.get("variants")
                if not isinstance(supplied, list) or len(supplied) < len(db_variants):
                    missing_variant_cards.append({
                        "component_id": comp.get("id"),
                        "product_id": pid,
                        "expected_variant_count": len(db_variants),
                    })
            if missing_variant_cards:
                return (
                    {
                        "render_ui_invalid": True,
                        "errors": [
                            f"product_card '{m['component_id']}' (product_id={m['product_id']}) "
                            f"has {m['expected_variant_count']} variants but the variants array "
                            f"was missing or incomplete. Multi-variant products MUST include the "
                            f"full variants list and default_variant_id so the shopper can pick "
                            f"an option."
                            for m in missing_variant_cards
                        ],
                        "hint": (
                            "Re-call render_ui with the variants array filled in for each "
                            "multi-variant product_card. Use the variants returned by "
                            "search_products / show_product verbatim."
                        ),
                    },
                    None,
                )
            enriched = enrich_render_ui_payload(
                tool_input, quantities, variants_by_pid, default_by_pid,
            )
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
        if tool_name == "update_preferences":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            allowed = {
                "style_tags", "likes", "dislikes", "personal_budget",
                "sizes", "gift_budget", "lifestyle",
                "quality_price", "bulk_individual", "discover_known",
            }
            patch = {k: v for k, v in tool_input.items() if k in allowed}
            if not patch:
                return {"saved": False, "reason": "empty_patch"}, None
            try:
                updated = await memory_set_prefs(user_id, patch, db)
            except Exception as e:
                return {"saved": False, "reason": str(e)}, None
            return {"saved": True, "updated_fields": list(patch.keys()), "prefs": updated}, None
        if tool_name == "save_product":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            try:
                # Redirect to default board if boards exist, otherwise legacy path
                board = await memory_get_or_create_default_board(user_id, db)
                created = await memory_save_product_to_board(user_id, board["id"], int(tool_input["product_id"]), db)
            except ValueError as ve:
                return {"saved": False, "reason": str(ve)}, None
            return {"saved": True, "product_id": int(tool_input["product_id"]), "newly_saved": created}, None
        if tool_name == "list_boards":
            if user_id is None:
                return {"boards": [], "reason": "not_logged_in"}, None
            return {"boards": await memory_list_boards(user_id, db)}, None
        if tool_name == "create_board":
            if user_id is None:
                return {"created": False, "reason": "not_logged_in"}, None
            try:
                board = await memory_create_board(
                    user_id,
                    str(tool_input.get("name") or ""),
                    tool_input.get("description"),
                    db,
                )
            except ValueError as ve:
                return {"created": False, "reason": str(ve)}, None
            return {"created": True, "board": board}, None
        if tool_name == "save_to_board":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            product_id = int(tool_input.get("product_id") or 0)
            board_id = tool_input.get("board_id")
            board_name = tool_input.get("board_name")
            try:
                if board_id:
                    target_board_id = int(board_id)
                elif board_name:
                    found = await memory_find_board_by_name(user_id, str(board_name), db)
                    if found:
                        target_board_id = found["id"]
                    else:
                        new_board = await memory_create_board(user_id, str(board_name), None, db)
                        target_board_id = new_board["id"]
                else:
                    default = await memory_get_or_create_default_board(user_id, db)
                    target_board_id = default["id"]
                newly_saved = await memory_save_product_to_board(user_id, target_board_id, product_id, db)
            except ValueError as ve:
                return {"saved": False, "reason": str(ve)}, None
            return {"saved": True, "product_id": product_id, "board_id": target_board_id, "newly_saved": newly_saved}, None
        if tool_name == "save_note_to_board":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            board_id = tool_input.get("board_id")
            text = str(tool_input.get("text") or "").strip()
            try:
                note = await memory_add_note_to_board(
                    user_id, int(board_id) if board_id else None, text, db
                )
            except ValueError as ve:
                return {"saved": False, "reason": str(ve)}, None
            return {"saved": True, "note": note}, None
        if tool_name == "ask_save_to_board":
            if user_id is None:
                return {"saved": False, "reason": "not_logged_in"}, None
            product_id = int(tool_input.get("product_id") or 0)
            product_name = str(tool_input.get("product_name") or "this product")
            boards = await memory_list_boards(user_id, db)
            if not boards:
                default = await memory_get_or_create_default_board(user_id, db)
                boards = [default]
            import uuid as _uuid
            question_id = f"board_pick_{_uuid.uuid4().hex[:8]}"
            payload = {
                "root": question_id,
                "components": [
                    {
                        "id": question_id,
                        "type": "board_picker",
                        "props": {
                            "question_id": question_id,
                            "product_id": product_id,
                            "product_name": product_name,
                            "boards": [
                                {"id": b["id"], "name": b["name"], "description": b.get("description")}
                                for b in boards
                            ],
                        },
                    }
                ],
            }
            return payload, "ui_tree"
        if tool_name == "add_to_cart":
            return await cart_service.add_item(
                variant_id=int(tool_input["variant_id"]) if tool_input.get("variant_id") is not None else None,
                product_id=int(tool_input["product_id"]) if tool_input.get("product_id") is not None else None,
                quantity=int(tool_input.get("quantity") or 1),
                user_id=user_id,
                session_id=session_id,
                db=db,
            ), None
        if tool_name == "view_cart":
            return await cart_service.view(user_id, session_id, db), None
        if tool_name == "remove_from_cart":
            return await cart_service.remove_item(int(tool_input["variant_id"]), user_id, session_id, db), None
        if tool_name == "checkout":
            return await cart_service.checkout(user_id, session_id, db), None
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


def _filter_where_sql(params: dict) -> tuple[str, dict]:
    """Translate agent filters (shop / price / stock / tags) into SQL fragments
    bound into the candidate queries, so ranking and RRF only ever see eligible
    products. Filtering after fusion silently dropped top-ranked hits and
    wasted candidate-pool slots. Fragments are hardcoded; values are binds."""
    clauses: list[str] = []
    binds: dict = {}
    if params.get("shop_id"):
        clauses.append("p.shop_id = :f_shop_id")
        binds["f_shop_id"] = int(params["shop_id"])
    shop_ids = params.get("shop_ids")
    if shop_ids:
        clauses.append("p.shop_id = ANY(:f_shop_ids)")
        binds["f_shop_ids"] = list(shop_ids)
    tags = params.get("tags")
    if tags:
        clauses.append("(p.description->'tags') ?| :f_tags")
        binds["f_tags"] = list(tags)
    min_p = params.get("min_price")
    max_p = params.get("max_price")
    in_stock_only = params.get("in_stock_only")
    if min_p is not None or max_p is not None or in_stock_only:
        v_conds: list[str] = []
        if min_p is not None:
            v_conds.append("v.price >= :f_min_price")
            binds["f_min_price"] = Decimal(str(min_p))
        if max_p is not None:
            v_conds.append("v.price <= :f_max_price")
            binds["f_max_price"] = Decimal(str(max_p))
        if in_stock_only:
            v_conds.append("v.quantity > 0")
        clauses.append(
            "EXISTS (SELECT 1 FROM product_variants v"
            " WHERE v.product_id = p.id AND " + " AND ".join(v_conds) + ")"
        )
    return "".join(f" AND {c}" for c in clauses), binds


def _hybrid_sql(filter_sql: str):
    return sql_text(f"""
WITH lex AS (
    SELECT p.id,
           row_number() OVER (ORDER BY ts_rank(p.search_vector, q) DESC) AS rank
    FROM products p, websearch_to_tsquery('english', :q) q
    WHERE (p.search_vector @@ q OR p.name % :q){filter_sql}
    LIMIT 50
),
sem AS (
    SELECT p.id,
           row_number() OVER (ORDER BY p.embedding <=> CAST(:qvec AS vector)) AS rank
    FROM products p
    WHERE p.embedding IS NOT NULL{filter_sql}
    ORDER BY p.embedding <=> CAST(:qvec AS vector)
    LIMIT 50
)
SELECT 'lex' AS src, id, rank FROM lex
UNION ALL
SELECT 'sem' AS src, id, rank FROM sem
""")


def _lex_only_sql(filter_sql: str):
    return sql_text(f"""
SELECT p.id,
       row_number() OVER (ORDER BY ts_rank(p.search_vector, q) DESC) AS rank
FROM products p, websearch_to_tsquery('english', :q) q
WHERE (p.search_vector @@ q OR p.name % :q){filter_sql}
LIMIT 50
""")


async def _search_products(params: dict, db: AsyncSession) -> dict:
    from sqlalchemy import func as sqlfunc
    limit = min(int(params.get("limit", 10)), 20)

    q = (params.get("query") or "").strip()

    # No query: browse path. Use random() when a seed was set via setseed()
    # upstream, otherwise fall back to alphabetical order.
    if not q:
        from sqlalchemy import func as sqlfunc
        order_col = sqlfunc.random() if params.get("seed") is not None else Product.name
        stmt = (
            select(Product, Shop.name.label("shop_name"))
            .join(Shop, Shop.id == Product.shop_id)
            .order_by(order_col)
        )
        stmt = _apply_filters(stmt, params)
        result = await db.execute(stmt.limit(limit))
        return await _format_results(result.all(), db)

    # Rung 4: 3 query variants (literal / synonyms / product-type).
    variants = await rewrite_query(q, db=db)
    if not variants:
        variants = [q]

    # Rung 2: embed variants. Empty list / all-None means no semantic branch.
    vectors = await embed_texts(variants)

    filter_sql, filter_binds = _filter_where_sql(params)
    hybrid_stmt = _hybrid_sql(filter_sql)
    lex_stmt = _lex_only_sql(filter_sql)

    # Per-variant hybrid CTE → ranked id lists for RRF.
    ranked_lists: list[list[int]] = []
    for variant, vec in zip(variants, vectors):
        if vec is not None:
            rows = (await db.execute(
                hybrid_stmt,
                {"q": variant, "qvec": vector_literal(vec), **filter_binds},
            )).all()
        else:
            rows = [("lex", *r) for r in (await db.execute(
                lex_stmt, {"q": variant, **filter_binds},
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

    # Widen the post-fusion candidate pool when the reranker is on so it has
    # material to reorder; otherwise just take what the agent asked for.
    rerank_on = _settings.zeroentropy_rerank_enabled and bool(_settings.zeroentropy_api_key)
    pool_cap = _settings.zeroentropy_rerank_pool if rerank_on else limit

    # Filters already applied inside the candidate queries, so nothing gets
    # dropped at hydrate time — only the top pool_cap ids are needed.
    pool_ids = fused_ids[:pool_cap]
    hydrate_stmt = (
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .where(Product.id.in_(pool_ids))
    )
    rows = (await db.execute(hydrate_stmt)).all()
    by_id = {p.id: (p, sn) for p, sn in rows}

    ordered = []
    for pid in pool_ids:
        hit = by_id.get(pid)
        if hit is not None:
            ordered.append(hit)
            if len(ordered) >= pool_cap:
                break

    if rerank_on and len(ordered) > 1:
        docs = []
        for product, _shop_name in ordered:
            desc = product.description or {}
            summary = desc.get("summary", "") if isinstance(desc, dict) else ""
            tags = desc.get("tags", []) if isinstance(desc, dict) else []
            tag_str = ", ".join(t for t in tags if isinstance(t, str))
            docs.append(f"{product.name}\n{summary}\n{tag_str}")
        idx_order, _telemetry = await _zerank_rerank(query=q, docs=docs, top_n=limit)
        try:
            from posthog import capture as _ph_capture
            _ph_capture("mason_reranker_called", properties={"success": True, **_telemetry})
        except Exception:
            logger.debug("posthog mason_reranker_called capture failed", exc_info=True)
        ordered = [ordered[i] for i in idx_order if 0 <= i < len(ordered)]

    return await _format_results(ordered[:limit], db)


def _apply_filters(stmt, params: dict):
    if params.get("shop_id"):
        stmt = stmt.where(Product.shop_id == params["shop_id"])
    min_p = params.get("min_price")
    max_p = params.get("max_price")
    in_stock_only = params.get("in_stock_only")
    if min_p is not None or max_p is not None or in_stock_only:
        sub = select(ProductVariant.product_id).distinct()
        if min_p is not None:
            sub = sub.where(ProductVariant.price >= Decimal(str(min_p)))
        if max_p is not None:
            sub = sub.where(ProductVariant.price <= Decimal(str(max_p)))
        if in_stock_only:
            sub = sub.where(ProductVariant.quantity > 0)
        stmt = stmt.where(Product.id.in_(sub))
    return stmt


def _variant_summary(v: ProductVariant) -> dict:
    return {
        "variant_id": v.id,
        "external_variant_id": v.external_variant_id,
        "variant_index": v.variant_index,
        "option_names": list(v.option_names or []),
        "option_values": list(v.option_values or []),
        "variant_label": v.variant_label,
        "price": float(v.price or 0),
        "quantity": int(v.quantity or 0),
        "image_url": v.image_url,
    }


async def _format_results(rows, db: AsyncSession) -> dict:
    if not rows:
        return {"count": 0, "products": []}
    pids = [p.id for p, _ in rows]
    variants_by_pid: dict[int, list[ProductVariant]] = {}
    v_result = await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id.in_(pids))
        .order_by(ProductVariant.variant_index)
    )
    for v in v_result.scalars().all():
        variants_by_pid.setdefault(v.product_id, []).append(v)

    products = []
    for product, shop_name in rows:
        variants = variants_by_pid.get(product.id, [])
        prices = [float(v.price) for v in variants if v.price is not None]
        in_stock = any((v.quantity or 0) > 0 for v in variants)
        default_v = next((v for v in variants if v.id == product.default_variant_id), None) or (variants[0] if variants else None)
        products.append({
            "product_id": product.id,
            "name": product.name,
            "handle": product.handle,
            "shop_name": shop_name,
            "shop_id": product.shop_id,
            "description_summary": (product.description or {}).get("summary", "")[:200],
            "tags": (product.description or {}).get("tags", []),
            "price_range": {
                "min": min(prices) if prices else 0.0,
                "max": max(prices) if prices else 0.0,
            },
            "in_stock": in_stock,
            "default_variant_id": default_v.id if default_v else None,
            "default_image_url": default_v.image_url if default_v else None,
            "variants": [_variant_summary(v) for v in variants],
        })
    return {"count": len(products), "products": products}


async def _show_product(params: dict, db: AsyncSession) -> dict:
    """Resolve a product + variants for rendering, plus the agent's display
    decision. Frontend reads display_mode + preselected_variant_id to decide
    whether to show a dropdown or pin a single variant card."""
    try:
        product_id = int(params["product_id"])
    except (KeyError, TypeError, ValueError):
        return {"error": "product_id required"}
    display_mode = params.get("display_mode") or "parent"
    if display_mode not in {"parent", "variant"}:
        return {"error": "display_mode must be 'parent' or 'variant'"}

    row = (await db.execute(
        select(Product, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == Product.shop_id)
        .where(Product.id == product_id)
    )).first()
    if row is None:
        return {"error": "product_not_found", "product_id": product_id}
    product, shop_name = row
    variants = list((await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id == product_id)
        .order_by(ProductVariant.variant_index)
    )).scalars().all())

    preselected = params.get("preselected_variant_id")
    if preselected is not None:
        try:
            preselected = int(preselected)
        except (TypeError, ValueError):
            preselected = None
    if preselected is not None and not any(v.id == preselected for v in variants):
        preselected = None

    formatted = (await _format_results([(product, shop_name)], db))["products"][0]
    formatted["display_mode"] = display_mode
    formatted["preselected_variant_id"] = (
        preselected if preselected is not None else product.default_variant_id
    )
    return formatted


async def _search_shops(params: dict, db: AsyncSession) -> dict:
    q = params.get("query", "")
    stmt = (
        select(Shop, func.count(Product.id).label("product_count"))
        .outerjoin(Product, Product.shop_id == Shop.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
        .limit(50)
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
