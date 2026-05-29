"""
Agentic loop — max 10 iterations, NDJSON streaming via async generator.

Each iteration:
  1. Call Claude with current message history + tools
  2. Stream text chunks as {"type":"text","content":"..."}
  3. On tool_use block: execute tool, emit events, append tool_result, loop
  4. On stop_reason == "end_turn": save turn, done
"""
import json
from typing import AsyncGenerator, Any
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from config import settings
from db.models import AgentSession, User
from agent.memory import load_short_term, load_long_term, save_turn
from agent.tools import TOOL_DEFINITIONS, execute_tool

MAX_ITERATIONS = 10

SYSTEM_PROMPT = """You are a personal shopping assistant for Main Street, a curated local shopping platform.

## Critical rule
Only show products and shops that exist in the database. Never invent, hallucinate, or suggest products that are not returned by search_products or search_shops. If a search returns zero results, say so honestly and try a broader query.

## Available shops in the catalog
TechNova (Electronics), GreenLeaf (Organic Food), UrbanThreads (Clothing), HomeHaven (Home & Garden), SportsPeak (Sports), BookNook (Books), PetPalace (Pet Supplies), BeautyBliss (Beauty), ToyTrove (Toys), KitchenKing (Kitchen)

## Your capabilities
- Search products by keyword, price range, shop, stock status
- Search shops by name or category
- Display products and shops as rich cards
- Ask clarifying questions via interactive question cards
- Remember user preferences (size, budget, brand preferences) — only when the user is logged in
- Create multi-step plans for complex shopping tasks

## Guidelines
- Be conversational and helpful
- Always call search_products or search_shops first — never build cards from memory
- For complex requests (multiple items, gift ideas, comparing options), call generate_plan first
- When the user mentions a preference (budget, size, etc.) and is logged in, call save_preference
- Keep responses concise — let the cards do the heavy lifting
- If a search returns no results, try one broader search before giving up

{long_term_memory}"""


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
    from sqlalchemy import update as sa_update
    from datetime import datetime, timezone
    session_row = (await db.execute(select(AgentSession).where(AgentSession.id == session_id))).scalars().first()
    if session_row:
        session_row.updated_at = datetime.now(timezone.utc)
        if session_row.title in ("New conversation", "Guest conversation"):
            session_row.title = user_message[:80]
        db.add(session_row)

    # Build message list
    messages = history + [{"role": "user", "content": user_content}]

    system = SYSTEM_PROMPT.format(long_term_memory=long_term)

    # Accumulate assistant content across iterations for final save
    accumulated_content = []
    accumulated_tool_calls = []
    accumulated_tool_results = []

    for iteration in range(MAX_ITERATIONS):
        yield _event({"type": "thinking", "content": f"Thinking... (step {iteration + 1})"})

        # Call Claude (non-streaming for tool use reliability)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system,
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )

        # Process response blocks
        tool_use_blocks = []
        text_blocks = []

        for block in response.content:
            if block.type == "text":
                text_blocks.append(block.text)
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

            if event_hint == "artifact":
                yield _event({
                    "type": "artifact",
                    "kind": block.name,
                    "data": block.input,
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
