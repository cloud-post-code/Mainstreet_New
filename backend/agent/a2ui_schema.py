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
    "questionnaire",
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
    "questionnaire": ("questionnaire_id", "steps", "current_step"),
    "product_details_modal": ("product_id", "name", "price", "shop_name"),
    "next_actions": ("actions",),
    "shop_card": ("shop_id", "name"),
    "plan": ("steps",),
}

VALID_GRID_LAYOUTS = {"recommendation", "comparison", "curated", "hero", "trio", "quad", "showcase"}


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
            expected_child_counts = {"hero": 1, "trio": 3, "quad": 4, "showcase": 6}
            if layout in expected_child_counts:
                child_ids = comp.get("children") or []
                expected = expected_child_counts[layout]
                if isinstance(child_ids, list) and len(child_ids) != expected:
                    errors.append(
                        f"components[{cid}].props.layout '{layout}' requires exactly "
                        f"{expected} product_card child(ren); got {len(child_ids)}."
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
        if ctype == "questionnaire":
            steps = props.get("steps")
            current_step = props.get("current_step")
            if not isinstance(steps, list) or len(steps) == 0:
                errors.append(
                    f"components[{cid}].props.steps must be a non-empty array of step objects."
                )
            else:
                seen_step_ids: set[str] = set()
                for si, step in enumerate(steps):
                    if not isinstance(step, dict):
                        errors.append(f"components[{cid}].props.steps[{si}] must be an object")
                        continue
                    step_id = step.get("step_id")
                    question = step.get("question")
                    kind = step.get("kind")
                    if not isinstance(step_id, str) or not step_id:
                        errors.append(f"components[{cid}].props.steps[{si}].step_id must be a non-empty string")
                    elif step_id in seen_step_ids:
                        errors.append(f"components[{cid}].props.steps[{si}].step_id '{step_id}' is duplicated")
                    else:
                        seen_step_ids.add(step_id)
                    if not isinstance(question, str) or not question:
                        errors.append(f"components[{cid}].props.steps[{si}].question must be a non-empty string")
                    if kind not in ("single", "multi", "text"):
                        errors.append(
                            f"components[{cid}].props.steps[{si}].kind '{kind}' invalid. "
                            f"Allowed: 'single', 'multi', 'text'."
                        )
                    if kind in ("single", "multi"):
                        options = step.get("options")
                        if not isinstance(options, list) or len(options) == 0:
                            errors.append(
                                f"components[{cid}].props.steps[{si}].options must be a non-empty array of strings "
                                f"when kind is '{kind}'."
                            )
                        elif not all(isinstance(o, str) for o in options):
                            errors.append(
                                f"components[{cid}].props.steps[{si}].options must contain only strings."
                            )
            if not isinstance(current_step, int) or isinstance(current_step, bool):
                errors.append(f"components[{cid}].props.current_step must be an integer")
            elif isinstance(steps, list) and (current_step < 0 or current_step > len(steps)):
                errors.append(
                    f"components[{cid}].props.current_step {current_step} out of range [0, {len(steps)}]."
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


def enrich_render_ui_payload(
    payload: dict,
    quantities: dict[int, int],
    variants_by_pid: dict[int, list[dict]] | None = None,
    default_variant_by_pid: dict[int, int] | None = None,
) -> dict:
    """Fill product_card quantity, variants, and default_variant_id from the
    database so the UI shows correct stock and option chips regardless of
    whether the agent included those fields in its render_ui payload."""
    if not quantities and not variants_by_pid and not default_variant_by_pid:
        return payload
    variants_by_pid = variants_by_pid or {}
    default_variant_by_pid = default_variant_by_pid or {}
    components = []
    for comp in payload.get("components") or []:
        if not isinstance(comp, dict) or comp.get("type") != "product_card":
            components.append(comp)
            continue
        props = dict(comp.get("props") or {})
        pid = props.get("product_id")
        if isinstance(pid, int):
            if pid in quantities:
                props["quantity"] = quantities[pid]
            # Always overwrite variants/default_variant_id with the canonical
            # DB values — the agent's copy can be stale or omitted entirely.
            if pid in variants_by_pid:
                props["variants"] = variants_by_pid[pid]
            if pid in default_variant_by_pid and default_variant_by_pid[pid] is not None:
                props.setdefault("default_variant_id", default_variant_by_pid[pid])
        components.append({**comp, "props": props})
    return {**payload, "components": components}


def collect_product_card_ids(payload: dict) -> list[int]:
    ids: list[int] = []
    for comp in payload.get("components") or []:
        if not isinstance(comp, dict) or comp.get("type") != "product_card":
            continue
        pid = (comp.get("props") or {}).get("product_id")
        if isinstance(pid, int):
            ids.append(pid)
    return ids


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
        "Every product_card for a product that has more than one variant MUST include the "
        "full `variants` array and `default_variant_id` so the user can pick an option — "
        "render_ui will be rejected otherwise. "
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
                                "product_card{product_id,name,price,shop_name,image_url?,quantity?,description_summary?,tags?,shop_id?,variants?:[{variant_id,option_names?:string[],option_values?:string[],variant_label?,price,quantity,image_url?}],default_variant_id?,display_mode?('parent'|'variant'),preselected_variant_id?}, "
                                "product_grid{layout(recommendation|comparison|curated|hero|trio|quad|showcase),title,subtitle?}, "
                                "comparison_table{products[{product_id,name,price,pros[],cons[],shop_name?,image_url?}],sort_by?}, "
                                "multiple_choice{question_id,question,choices,hint?}, "
                                "question_card{question_id,question,options?,hint?}, "
                                "questionnaire{questionnaire_id,current_step,steps:[{step_id,question,kind('single'|'multi'|'text'),options?:string[],hint?,allow_other?:bool}],title?}, "
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
