"""
A2UI catalog + payload validator.

The agent emits one render_ui tool call per turn. The payload is a flat list of
components with stable IDs, a root id, and per-type props. This module is the
source of truth for what the agent is allowed to send. The frontend mirrors
this catalog in src/a2ui/registry.ts — keep them in sync.
"""
from typing import Any, Literal

ALLOWED_TYPES: set[str] = {
    "stack",
    "text_block",
    "reasoning_block",
    "product_card",
    "product_grid",
    "comparison_table",
    "multiple_choice",
    "question_card",
    "product_details_modal",
    "next_actions",
    "shop_card",
    "plan",
}

CONTAINER_TYPES: set[str] = {"stack", "product_grid"}

REQUIRED_PROPS: dict[str, tuple[str, ...]] = {
    "stack": (),
    "text_block": ("content",),
    "reasoning_block": ("summary",),
    "product_card": ("product_id", "name", "price", "shop_name"),
    "product_grid": ("layout", "title"),
    "comparison_table": ("products",),
    "multiple_choice": ("question_id", "question", "choices"),
    "question_card": ("question_id", "question"),
    "product_details_modal": ("product_id", "name", "price", "shop_name"),
    "next_actions": ("actions",),
    "shop_card": ("shop_id", "name"),
    "plan": ("steps",),
}

VALID_GRID_LAYOUTS = {"recommendation", "comparison", "curated"}


def validate_render_ui(payload: Any) -> list[str]:
    """Return a list of error strings. Empty list means valid."""
    errors: list[str] = []

    if not isinstance(payload, dict):
        return ["payload must be an object"]

    root = payload.get("root")
    components = payload.get("components")

    if not isinstance(root, str) or not root:
        errors.append("`root` must be a non-empty string id")
    if not isinstance(components, list) or not components:
        errors.append("`components` must be a non-empty array")
        return errors

    by_id: dict[str, dict] = {}
    for i, comp in enumerate(components):
        if not isinstance(comp, dict):
            errors.append(f"components[{i}] must be an object")
            continue
        cid = comp.get("id")
        ctype = comp.get("type")
        if not isinstance(cid, str) or not cid:
            errors.append(f"components[{i}].id must be a non-empty string")
            continue
        if cid in by_id:
            errors.append(f"duplicate component id: {cid}")
            continue
        if not isinstance(ctype, str) or ctype not in ALLOWED_TYPES:
            errors.append(
                f"components[{cid}].type '{ctype}' is not in the catalog. "
                f"Allowed: {sorted(ALLOWED_TYPES)}"
            )
            continue
        props = comp.get("props", {})
        if not isinstance(props, dict):
            errors.append(f"components[{cid}].props must be an object")
            continue
        for required in REQUIRED_PROPS[ctype]:
            if required not in props:
                errors.append(f"components[{cid}] ({ctype}) missing required prop '{required}'")
        if ctype == "product_grid":
            layout = props.get("layout")
            if layout not in VALID_GRID_LAYOUTS:
                errors.append(
                    f"components[{cid}].props.layout '{layout}' invalid. "
                    f"Allowed: {sorted(VALID_GRID_LAYOUTS)}"
                )
        if ctype == "comparison_table":
            products = props.get("products")
            if not isinstance(products, list) or len(products) == 0:
                errors.append(
                    f"components[{cid}].props.products must be a non-empty array of "
                    f"product objects with at minimum {{product_id, name, price, pros, cons}}."
                )
            else:
                for i, p in enumerate(products):
                    if not isinstance(p, dict):
                        errors.append(f"components[{cid}].props.products[{i}] must be an object")
                        continue
                    for required in ("product_id", "name", "price", "pros", "cons"):
                        if required not in p:
                            errors.append(
                                f"components[{cid}].props.products[{i}] missing '{required}'. "
                                f"Each product row needs product_id, name, price, pros (array of strings), cons (array of strings)."
                            )
                    if "pros" in p and not isinstance(p["pros"], list):
                        errors.append(f"components[{cid}].props.products[{i}].pros must be an array of strings")
                    if "cons" in p and not isinstance(p["cons"], list):
                        errors.append(f"components[{cid}].props.products[{i}].cons must be an array of strings")
            product_ids = props.get("product_ids")
            if isinstance(product_ids, list) and isinstance(products, list):
                pids_in_products = {
                    p.get("product_id") for p in products if isinstance(p, dict)
                }
                missing = [pid for pid in product_ids if pid not in pids_in_products]
                if missing:
                    errors.append(
                        f"components[{cid}].props.product_ids contains ids not found "
                        f"in products: {missing}."
                    )
        children = comp.get("children")
        if children is not None and not isinstance(children, list):
            errors.append(f"components[{cid}].children must be an array of ids")
            continue
        if children and ctype not in CONTAINER_TYPES:
            errors.append(f"components[{cid}] ({ctype}) cannot have children")
        by_id[cid] = comp

    if root and root not in by_id:
        errors.append(f"`root` '{root}' is not in components")

    # Reference + cycle check via DFS from root. Runs even if per-component
    # errors exist above so the agent gets a complete error report in one shot.
    if root in by_id:
        WHITE, GRAY, BLACK = 0, 1, 2
        color: dict[str, int] = {cid: WHITE for cid in by_id}

        def dfs(node_id: str) -> None:
            if node_id not in by_id:
                errors.append(f"child id '{node_id}' not in components")
                return
            if color[node_id] == GRAY:
                errors.append(f"cycle detected involving '{node_id}'")
                return
            if color[node_id] == BLACK:
                return
            color[node_id] = GRAY
            for child_id in by_id[node_id].get("children") or []:
                if not isinstance(child_id, str):
                    errors.append(f"{node_id}.children contains non-string id")
                    continue
                dfs(child_id)
            color[node_id] = BLACK

        dfs(root)

        # Visited (BLACK or GRAY) means reachable from root. Anything still
        # WHITE is an orphan. Counting GRAY as visited avoids a duplicate
        # "unreachable" error when a node is also part of a detected cycle.
        orphans = [cid for cid, c in color.items() if c == WHITE]
        if orphans:
            errors.append(
                f"unreachable components from root: {orphans}. "
                f"Every component must be referenced by `root` or a child chain."
            )

    return errors


RENDER_UI_TOOL_SCHEMA: dict = {
    "name": "render_ui",
    "description": (
        "Render the UI for this turn as a single A2UI payload. "
        "Call this exactly once per turn after any search_products / search_shops calls. "
        "The payload is a flat list of components plus a `root` id. "
        "Every component must have a unique id, a type from the catalog, and required props. "
        "Container components (`stack`, `product_grid`) use `children: [ids]` to compose. "
        "Every payload MUST include a `text_block` for conversational explanation. "
        "Once a recommendation is made, include a `reasoning_block` with a plain-text summary "
        "(1-3 sentences, no UI references). "
        "After calling render_ui, end your turn."
    ),
    "input_schema": {
        "type": "object",
        "required": ["root", "components"],
        "properties": {
            "root": {
                "type": "string",
                "description": "The id of the root component (typically a `stack`).",
            },
            "components": {
                "type": "array",
                "description": "Flat list of components. Order does not matter; structure comes from `children` arrays.",
                "items": {
                    "type": "object",
                    "required": ["id", "type", "props"],
                    "properties": {
                        "id": {"type": "string", "description": "Stable unique id like 'grid_1'."},
                        "type": {
                            "type": "string",
                            "enum": sorted(ALLOWED_TYPES),
                            "description": "Component type from the catalog.",
                        },
                        "props": {
                            "type": "object",
                            "description": (
                                "Per-type props. See catalog: "
                                "stack{}, text_block{content,tone?}, "
                                "reasoning_block{summary}, "
                                "product_card{product_id,name,price,shop_name,image_url?,quantity?,description_summary?,tags?,shop_id?}, "
                                "product_grid{layout(recommendation|comparison|curated),title,subtitle?}, "
                                "comparison_table{products[{product_id,name,price,pros[],cons[],shop_name?,image_url?}],sort_by?}, "
                                "multiple_choice{question_id,question,choices,hint?}, "
                                "question_card{question_id,question,options?,hint?}, "
                                "product_details_modal{product_id,name,price,shop_name,image_url?,gallery?,description_long?,tags?}, "
                                "next_actions{actions[{label,intent}]}, "
                                "shop_card{shop_id,name,logo_url?,description?,website_url?,product_count?}, "
                                "plan{steps}."
                            ),
                        },
                        "children": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Child component ids. Only valid on `stack` and `product_grid`.",
                        },
                    },
                },
            },
        },
    },
}
