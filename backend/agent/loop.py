"""
Agentic loop — max 10 iterations, NDJSON streaming via async generator.

Each iteration:
  1. Call Claude with current message history + tools
  2. Stream text chunks as {"type":"text","content":"..."}
  3. On tool_use block: execute tool, emit events, append tool_result, loop
  4. On stop_reason == "end_turn": save turn, done

The agent emits one render_ui(payload) call per turn after searching, then ends.
The payload is streamed to the client as a ui_tree event for the A2UI renderer.
"""
import json
import logging
import traceback
from typing import AsyncGenerator, Any
import anthropic

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from config import settings
from db.models import AgentSession
from agent.memory import load_short_term, load_long_term, save_turn
from agent.tools import TOOL_DEFINITIONS, execute_tool
from agent.streaming import stream_claude

MAX_ITERATIONS = 10

SYSTEM_PROMPT = """You are Mason, a personal shopping assistant for Main Street, a curated local shopping platform.

## Critical rule
Only show products and shops that exist in the database. Never invent, hallucinate, or suggest products that are not returned by search_products or search_shops. If a search returns zero results, say so honestly and try a broader query.

## Catalog
The catalog is dynamic. Always call search_shops or search_products before recommending anything. If results are empty, say so honestly and suggest a broader query.

## How you respond — A2UI

Every response is a single render_ui(payload) call after any necessary searches. The payload is a flat list of components with stable ids and a `root` id (typically a `stack`).

### Component catalog (only these types are allowed)

- `stack` — vertical container. Props: {gap?}. Children: any.
- `text_block` — conversational explanation paragraph. Props: {content, tone?(primary|muted)}. No children.
- `reasoning_block` — collapsible plain-text reasoning. Props: {summary}. Plain text only — no UI references, no card mentions, 1-3 sentences.
- `product_card` — single product. Props: {product_id, name, price, shop_name, image_url?, quantity?, description_summary?, tags?, shop_id?}. No children.
- `product_grid` — multi-product container. Props: {layout(recommendation|comparison|curated), title, subtitle?}. Children: product_card ids.
- `comparison_table` — side-by-side comparison. Props: {product_ids (column order — the ids you want as columns, in order), products (inline full product data keyed by product_id; must include every id from product_ids), attributes (rows, e.g. ["price","stock","tags"]), sort_by?}. No children.
- `multiple_choice` — preference question. Props: {question_id, question, choices, hint?}. No children.
- `question_card` — free-text clarification. Props: {question_id, question, options?, hint?}. No children.
- `product_details_modal` — expanded product view. Props: {product_id, name, price, shop_name, image_url?, gallery?, description_long?, tags?}. No children.
- `next_actions` — follow-up chips. Props: {actions[{label, intent}]}. No children.
- `shop_card` — shop card. Props: {shop_id, name, logo_url?, description?, website_url?, product_count?}. No children.
- `plan` — plan dropdown (rarely emitted directly; generate_plan handles it). Props: {steps}.

### Standard response structure

The root is always a `stack`. Children appear in this order:

1. Main visual — `product_grid` or `comparison_table` or `product_details_modal` or `multiple_choice`
2. `text_block` — REQUIRED, conversational explanation (2-4 sentences, warm, helpful)
3. (optional) `next_actions` — chips for "Compare top 3", "Show details", etc.
4. (optional but recommended) `reasoning_block` — included whenever you made a recommendation

### Decision framework

| User intent | Layout |
|---|---|
| "Find X" / "Show X" | stack[product_grid(recommendation), text_block, next_actions?, reasoning_block] |
| "Compare these" / "Compare top N" | stack[comparison_table, text_block, reasoning_block] |
| "Help me choose" / preferences unclear | stack[multiple_choice, text_block]  (no reasoning yet) |
| "Show details for X" | stack[product_details_modal, text_block] |
| "What shops sell Y" | stack[shop_card, shop_card, ..., text_block] |
| "X under $Y" / filtered search | search_products with max_price filter → stack[product_grid, text_block, reasoning_block] |
| Complex multi-step (gift research, multi-item) | generate_plan first, then render_ui per step |

### Hard rules

1. Always call search_products or search_shops BEFORE render_ui whenever the UI will reference products or shops.
2. Exactly one render_ui call per turn. After render_ui, end your turn.
3. Every render_ui payload MUST include a `text_block`.
4. `reasoning_block.summary` is plain text only. Never reference cards, images, grids, or the UI. 1-3 sentences. Example: "Evaluated 18 products against your $100 budget. Picked these three for review scores and brand reliability; skipped two that were out of stock."
5. Component ids must be unique and referenced from `root` through `children`. No orphans.
6. Container components (`stack`, `product_grid`) use `children: [ids]`. Leaf components (cards, blocks, tables, panels) do not have children.
7. If render_ui returns a validation error, fix it and call render_ui again in the same turn.

### Example payload — "Find me running shoes under $100"

After search_products returns 6 matches, call render_ui with:

```
{
  "root": "root_1",
  "components": [
    {"id":"root_1","type":"stack","props":{},"children":["grid_1","text_1","actions_1","reason_1"]},
    {"id":"grid_1","type":"product_grid","props":{"layout":"recommendation","title":"Top picks under $100"},"children":["card_1","card_2","card_3"]},
    {"id":"card_1","type":"product_card","props":{"product_id":17,"name":"Trailrunner Pro","price":89,"shop_name":"SportsPeak","tags":["waterproof","trail"]}},
    {"id":"card_2","type":"product_card","props":{"product_id":21,"name":"CloudStride","price":95,"shop_name":"SportsPeak"}},
    {"id":"card_3","type":"product_card","props":{"product_id":33,"name":"DailyMile","price":75,"shop_name":"SportsPeak"}},
    {"id":"text_1","type":"text_block","props":{"content":"These three balance comfort, durability, and price. If you prioritize cushioning, lean toward CloudStride; if you'll hit trails, Trailrunner Pro is the safer pick."}},
    {"id":"actions_1","type":"next_actions","props":{"actions":[{"label":"Compare top 3","intent":"compare"},{"label":"Show details for Trailrunner Pro","intent":"open_details"}]}},
    {"id":"reason_1","type":"reasoning_block","props":{"summary":"Searched 6 in-stock running shoes under $100. Selected for review quality, trail vs road suitability, and brand reliability."}}
  ]
}
```

## Memory and preferences

- When the user mentions a preference (budget, size, brand) and is logged in, call save_preference.

{{LONG_TERM_MEMORY}}"""


def _event(obj: dict) -> str:
    return json.dumps(obj) + "\n"


async def run_agent_turn(
    user_message: str,
    session_id: int,
    user_id: int | None,
    question_card_id: str | None,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Async generator yielding NDJSON event strings."""
    try:
        async for ev in _run_agent_turn_inner(
            user_message, session_id, user_id, question_card_id, db
        ):
            yield ev
    except Exception as e:
        tb = traceback.format_exc()
        logger.exception("run_agent_turn crashed for session %s", session_id)
        yield _event({
            "type": "error",
            "error": f"{type(e).__name__}: {e}",
            "traceback": tb,
        })
        yield _event({"type": "done"})


async def _run_agent_turn_inner(
    user_message: str,
    session_id: int,
    user_id: int | None,
    question_card_id: str | None,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Load memory — anonymous users get no long-term memory
    long_term = await load_long_term(user_id, db) if user_id else ""
    history = await load_short_term(session_id, db)

    # Save the user turn
    user_content: Any = user_message
    if question_card_id:
        # Wrap answer as a tool_result for the question card
        user_content = [
            {"type": "tool_result", "tool_use_id": question_card_id, "content": user_message}
        ]

    await save_turn(session_id, "user", user_content, None, None, db)

    # Update session: stamp updated_at and set title from first message if still default
    from datetime import datetime, timezone
    session_row = (await db.execute(select(AgentSession).where(AgentSession.id == session_id))).scalars().first()
    if session_row:
        session_row.updated_at = datetime.now(timezone.utc)
        if session_row.title in ("New conversation", "Guest conversation"):
            session_row.title = user_message[:80]
        db.add(session_row)

    # Build message list
    messages = history + [{"role": "user", "content": user_content}]

    # Use replace() instead of .format() so the JSON example payloads, prop
    # docs like {content, tone?}, and grid example like {gap?} survive
    # without needing every brace escaped.
    system = SYSTEM_PROMPT.replace("{{LONG_TERM_MEMORY}}", long_term)

    # Accumulate assistant content across iterations for final save
    accumulated_content = []
    accumulated_tool_calls = []
    accumulated_tool_results = []

    for iteration in range(MAX_ITERATIONS):
        if iteration > 0:
            yield _event({"type": "thinking", "content": f"\n\n— Step {iteration + 1} —\n"})

        response = None
        for kind, payload in stream_claude(
            client,
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system,
            tools=TOOL_DEFINITIONS,
            messages=messages,
        ):
            if kind == "thinking":
                yield _event({"type": "thinking", "content": payload})
            elif kind == "text":
                yield _event({"type": "thinking", "content": payload})
            elif kind == "done":
                response = payload

        if response is None:
            break

        # Process response blocks
        tool_use_blocks = []

        for block in response.content:
            if block.type == "text":
                accumulated_content.append({"type": "text", "text": block.text})
                yield _event({"type": "text", "content": block.text})
            elif block.type == "tool_use":
                tool_use_blocks.append(block)
                tc = {
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                }
                accumulated_content.append(tc)
                accumulated_tool_calls.append(tc)
                yield _event({"type": "tool_call", "tool": block.name, "args": block.input, "id": block.id})

        # If no tool calls, we're done
        if not tool_use_blocks or response.stop_reason == "end_turn":
            break

        # Execute tools and collect results
        tool_results = []
        for block in tool_use_blocks:
            result, event_hint = await execute_tool(
                block.name, block.input, user_id, session_id, db
            )

            if event_hint == "ui_tree":
                yield _event({
                    "type": "ui_tree",
                    "root": block.input.get("root"),
                    "components": block.input.get("components", []),
                    "tool_use_id": block.id,
                })
            elif event_hint == "plan_update":
                yield _event({"type": "plan_update", "steps": result.get("steps", [])})
            else:
                yield _event({"type": "tool_result", "tool": block.name, "result": result})

            tool_result_block = {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result),
            }
            tool_results.append(tool_result_block)
            accumulated_tool_results.append(tool_result_block)

        # Append assistant + tool results to message history for next iteration
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    # Save the complete assistant turn
    await save_turn(
        session_id,
        "assistant",
        accumulated_content,
        accumulated_tool_calls or None,
        accumulated_tool_results or None,
        db,
    )
    await db.commit()

    yield _event({"type": "done"})
