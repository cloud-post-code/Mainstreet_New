"""Short-term (session turns) and long-term (user_memory) helpers."""
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from db.models import AgentTurn, UserMemory

MAX_SHORT_TERM_TURNS = 20   # last N turns loaded into context
MAX_LONG_TERM_KEYS = 50     # cap per user


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
    for turn in turns:
        if turn.role == "user":
            content = turn.content
            # content can be a string, a list (tool_result blocks), or empty
            if not content:
                continue
            messages.append({"role": "user", "content": content})
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


async def load_long_term(user_id: int, db: AsyncSession) -> str:
    """Return long-term memory as a formatted string for the system prompt."""
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id).order_by(UserMemory.updated_at.desc())
    )
    memories = result.scalars().all()
    if not memories:
        return ""
    lines = ["## User Preferences & History"]
    for m in memories:
        lines.append(f"- **{m.key}**: {m.value}")
    return "\n".join(lines)


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


async def save_preference(user_id: int, key: str, value: Any, db: AsyncSession):
    """Upsert a long-term memory key. Evicts oldest if over cap."""
    result = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.key == key)
    )
    existing = result.scalars().first()
    if existing:
        existing.value = value
    else:
        # Check cap
        count_result = await db.execute(
            select(UserMemory).where(UserMemory.user_id == user_id).order_by(UserMemory.updated_at.asc())
        )
        all_memories = count_result.scalars().all()
        if len(all_memories) >= MAX_LONG_TERM_KEYS:
            oldest = all_memories[0]
            await db.delete(oldest)
        db.add(UserMemory(user_id=user_id, key=key, value=value))
    await db.flush()
