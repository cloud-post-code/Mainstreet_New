"""Goal-driven note updater.

After a conversation has been running for 30+ minutes and a goal was set
via /goal, Mason uses claude-haiku to review the full conversation and
write/update notes that help achieve that goal in future sessions.

Triggered once per session from the runner after each turn completes.
Uses a dedicated user_memory key "goal_notes_updated:<session_id>" to
avoid re-running more than once per session.
"""
import json
import logging
from datetime import datetime, timezone

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.memory import add_note, list_notes, load_short_term
from config import settings
from db.models import AgentSession, UserMemory

logger = logging.getLogger(__name__)

GOAL_LOCK_KEY_PREFIX = "goal_notes_updated:"
GOAL_TRIGGER_SECONDS = 30 * 60  # 30 minutes

GOAL_UPDATER_PROMPT = """You are Mason's memory assistant. Your job is to review a conversation and extract durable facts about the user that will help Mason achieve the stated goal in future sessions.

Goal: {goal}

Review the conversation below and identify facts worth saving as notes. A note is a short third-person fact about the user (e.g. "Prefers sustainable materials", "Has a 7-year-old son named Leo", "Looking for a gift under $50 for a colleague"). Each note must be under 280 characters.

Only extract facts that are:
1. Durable (true beyond this conversation)
2. Relevant to achieving the goal
3. Not already captured in existing notes

Existing notes (do not duplicate):
{existing_notes}

Conversation:
{conversation}

Return a JSON array of note strings. Return [] if nothing new is worth saving. Return only valid JSON, no prose.
Example: ["Shops for a partner who likes minimalist design", "Budget around $100 for gifts"]"""


def _format_conversation(history: list[dict]) -> str:
    lines = []
    for msg in history:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        parts.append(f"[tool: {block.get('name')}]")
            content = " ".join(p for p in parts if p)
        if content:
            lines.append(f"{role.upper()}: {content}")
    return "\n".join(lines)


async def maybe_run_goal_update(
    session_id: int,
    user_id: int,
    db: AsyncSession,
) -> None:
    """Check eligibility and run goal-based note update if conditions are met.

    Conditions:
    - Session has a goal set
    - 30+ minutes have elapsed since session.created_at
    - Has not already run for this session (lock key absent)
    """
    try:
        session = (await db.execute(
            select(AgentSession).where(AgentSession.id == session_id)
        )).scalars().first()

        if not session or not session.goal:
            return

        # Check elapsed time
        created = session.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created is None:
            return
        elapsed = (datetime.now(timezone.utc) - created).total_seconds()
        if elapsed < GOAL_TRIGGER_SECONDS:
            return

        # Check lock — only run once per session
        lock_key = f"{GOAL_LOCK_KEY_PREFIX}{session_id}"
        existing_lock = (await db.execute(
            select(UserMemory).where(
                UserMemory.user_id == user_id,
                UserMemory.key == lock_key,
            )
        )).scalars().first()
        if existing_lock:
            return

        # Acquire lock immediately so concurrent turns don't double-fire
        db.add(UserMemory(
            user_id=user_id,
            key=lock_key,
            value={"session_id": session_id, "ran_at": datetime.now(timezone.utc).isoformat()},
        ))
        await db.flush()
        await db.commit()

        await _run_goal_update(session_id, user_id, session.goal, db)

    except Exception:
        logger.exception("goal_updater: unexpected error for session %s", session_id)


async def _run_goal_update(
    session_id: int,
    user_id: int,
    goal: str,
    db: AsyncSession,
) -> None:
    history = await load_short_term(session_id, db)
    if not history:
        return

    existing = await list_notes(user_id, db)
    existing_text = "\n".join(f"- {n['text']}" for n in existing) or "(none)"
    conversation_text = _format_conversation(history)

    prompt = GOAL_UPDATER_PROMPT.format(
        goal=goal,
        existing_notes=existing_text,
        conversation=conversation_text,
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception:
        logger.exception("goal_updater: Haiku API call failed for session %s", session_id)
        return

    raw = ""
    for block in response.content:
        if hasattr(block, "text"):
            raw = block.text.strip()
            break

    try:
        notes = json.loads(raw)
        if not isinstance(notes, list):
            notes = []
    except (json.JSONDecodeError, ValueError):
        logger.warning("goal_updater: could not parse Haiku response for session %s: %r", session_id, raw[:200])
        return

    saved_count = 0
    for note_text in notes:
        if isinstance(note_text, str) and note_text.strip():
            try:
                await add_note(user_id, note_text.strip(), db)
                saved_count += 1
            except Exception:
                logger.warning("goal_updater: failed to save note for user %s", user_id, exc_info=True)

    if saved_count:
        await db.commit()
        logger.info("goal_updater: saved %d notes for session %s (goal: %r)", saved_count, session_id, goal[:60])
    else:
        logger.info("goal_updater: no new notes for session %s", session_id)
