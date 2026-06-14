"""Background runner for Mason turns.

Decouples the work of running a turn from the HTTP request that started it.
The runner persists each NDJSON event to ``agent_turn_events`` so any client
can attach later, replay history, then tail the live stream.

v1 design notes:
- Tasks run as ``asyncio.Task`` in the FastAPI process (no Celery/Redis).
- A process restart leaves rows stuck in ``status='running'``; ``sweep_zombie_runs``
  is run at app startup to mark those as failed.
- Hard cap of MAX_BACKGROUND_RUNS concurrent ``running`` rows per user. Extras
  get rejected with HTTP 429.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from datetime import datetime, timezone
from typing import Optional

import posthog
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from agent.loop import run_agent_turn
from agent.router_classifier import classify_intent
from agent.goal_updater import maybe_run_goal_update
from db.database import AsyncSessionLocal
from db.models import AgentPlan, AgentSession, AgentTurnEvent, AgentTurnRun

logger = logging.getLogger(__name__)

MAX_BACKGROUND_RUNS = 3
# How long the session.processing lock can stay set before we treat it as stale.
# Drops the old 2-minute kludge: the runner clears the flag reliably, but this
# guards against the very rare case where the runner itself dies mid-flight.
STALE_PROCESSING_SECONDS = 120

# Live registry of in-flight runner tasks, keyed by run_id. Used so cancel
# requests can interrupt the underlying asyncio.Task.
_active_tasks: dict[int, asyncio.Task] = {}


async def _count_user_active_runs(db: AsyncSession, user_id: int) -> int:
    q = select(func.count(AgentTurnRun.id)).where(
        AgentTurnRun.user_id == user_id,
        AgentTurnRun.status == "running",
    )
    return (await db.execute(q)).scalar() or 0


async def start_turn_run(
    db: AsyncSession,
    *,
    session: AgentSession,
    user_id: Optional[int],
    message: str,
    question_card_id: Optional[str],
    mode_override: Optional[str],
) -> AgentTurnRun:
    """Create the run row, set the per-session lock, schedule the background task.

    Raises HTTPException(429) if the per-user cap is hit or the session already
    has a non-stale in-flight turn.
    """
    if session.processing:
        now = datetime.now(timezone.utc)
        last = session.updated_at
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if last is None or (now - last).total_seconds() < STALE_PROCESSING_SECONDS:
            raise HTTPException(
                status_code=429,
                detail="A turn is already in progress for this session",
            )
        logger.warning("Clearing stale processing lock for session %s", session.id)

    if user_id is not None:
        active = await _count_user_active_runs(db, user_id)
        if active >= MAX_BACKGROUND_RUNS:
            raise HTTPException(status_code=429, detail="max_background_turns")

    run = AgentTurnRun(
        session_id=session.id,
        user_id=user_id,
        status="running",
        user_message=message,
        question_card_id=question_card_id,
        mode=mode_override,
    )
    db.add(run)
    await db.execute(
        update(AgentSession).where(AgentSession.id == session.id).values(processing=True)
    )
    await db.commit()
    await db.refresh(run)

    task = asyncio.create_task(_run_turn_background(run.id))
    _active_tasks[run.id] = task
    # Clean the registry when the task ends so cancel() lookups stay accurate.
    task.add_done_callback(lambda _t, rid=run.id: _active_tasks.pop(rid, None))
    return run


async def cancel_run(run_id: int) -> bool:
    task = _active_tasks.get(run_id)
    if task is None:
        return False
    task.cancel()
    return True


async def _append_event(run_id: int, seq: int, payload: dict) -> None:
    # Dedicated session so we don't commit the agent loop's pending changes
    # (assistant turn rows, session title updates, usage rows) underneath it
    # every time an event fires.
    async with AsyncSessionLocal() as ev_db:
        ev_db.add(AgentTurnEvent(run_id=run_id, seq=seq, payload=payload))
        await ev_db.commit()


async def _decide_mode(
    *,
    session_type: str,
    mode_override: Optional[str],
    message: str,
    has_active_plan: bool,
    question_card_id: Optional[str],
) -> tuple[str, int, str]:
    """Mirrors the inline classifier dispatch in routers/agent.py:stream()."""
    if session_type == "mason":
        return "full", 0, "session_type"
    if mode_override is not None:
        return mode_override, 0, "user_override"
    mode, classify_ms = await classify_intent(
        message,
        {
            "has_active_plan": has_active_plan,
            "has_active_questionnaire": bool(question_card_id),
            "last_assistant_action": None,
        },
    )
    return mode, classify_ms, "classifier"


async def _run_turn_background(run_id: int) -> None:
    """The actual turn execution. Runs detached from any HTTP request."""
    started_at = time.perf_counter()
    had_products = False
    product_count = 0
    ui_tree_count = 0

    async with AsyncSessionLocal() as db:
        # Load the run and its session.
        run = (await db.execute(
            select(AgentTurnRun).where(AgentTurnRun.id == run_id)
        )).scalars().first()
        if run is None:
            logger.error("runner: run %s vanished before start", run_id)
            return
        session = (await db.execute(
            select(AgentSession).where(AgentSession.id == run.session_id)
        )).scalars().first()
        if session is None:
            logger.error("runner: session %s vanished before run %s", run.session_id, run_id)
            run.status = "failed"
            run.error = "session_missing"
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
            return

        session_type = getattr(session, "session_type", "shop") or "shop"
        raw_override = (run.mode or "").strip().lower() or None
        mode_override = raw_override if raw_override in ("fast", "full") else None

        has_active_plan = False
        if session_type != "mason":
            plan_row = (await db.execute(
                select(AgentPlan).where(AgentPlan.session_id == run.session_id).limit(1)
            )).scalars().first()
            has_active_plan = plan_row is not None

        try:
            mode, classify_ms, decided_by = await _decide_mode(
                session_type=session_type,
                mode_override=mode_override,
                message=run.user_message,
                has_active_plan=has_active_plan,
                question_card_id=run.question_card_id,
            )
        except Exception:
            logger.exception("runner: classifier failed for run %s", run_id)
            mode, classify_ms, decided_by = "full", 0, "fallback"

        try:
            _classifier_distinct_id = str(run.user_id) if run.user_id else f"session_{run.session_id}"
            posthog.capture(
                _classifier_distinct_id,
                "mason_classifier_decided",
                properties={
                    "session_id": run.session_id,
                    "session_type": session_type,
                    "chosen_mode": mode,
                    "classify_ms": classify_ms,
                    "decided_by": decided_by,
                    "had_active_plan": has_active_plan,
                    "had_active_questionnaire": bool(run.question_card_id),
                },
            )
        except Exception:
            logger.debug("posthog capture failed for mason_classifier_decided", exc_info=True)

        seq = 0

        async def emit(payload: dict) -> None:
            nonlocal seq
            seq += 1
            await _append_event(run_id, seq, payload)

        await emit({
            "type": "meta",
            "mode": mode,
            "classify_ms": classify_ms,
            "decided_by": decided_by,
        })

        try:
            async for chunk in run_agent_turn(
                user_message=run.user_message,
                session_id=run.session_id,
                user_id=run.user_id,
                question_card_id=run.question_card_id,
                db=db,
                mode=mode,
            ):
                # ``chunk`` is an NDJSON string. We persist the parsed object
                # so the stream endpoint can re-serialize cleanly.
                try:
                    payload = json.loads(chunk)
                except Exception:
                    payload = {"type": "text", "content": str(chunk)}

                if isinstance(payload, dict) and payload.get("type") == "ui_tree":
                    ui_tree_count += 1
                    comps = payload.get("components") or []
                    pc = sum(
                        1 for c in comps
                        if isinstance(c, dict) and c.get("type") == "product_card"
                    )
                    if pc:
                        had_products = True
                        product_count += pc

                await emit(payload)

            run.status = "done"

            # Fire goal-based note update (Haiku) if 30min has elapsed and
            # a goal is set. Best-effort — never block or fail the turn.
            if run.user_id is not None:
                try:
                    await maybe_run_goal_update(run.session_id, run.user_id, db)
                except Exception:
                    logger.debug("goal_updater: skipped for run %s", run_id, exc_info=True)

        except asyncio.CancelledError:
            logger.info("runner: run %s cancelled", run_id)
            run.status = "cancelled"
            try:
                await emit({"type": "error", "error": "Cancelled."})
            except Exception:
                logger.debug("runner: failed to write cancel event for %s", run_id)
            raise
        except Exception as e:
            tb = traceback.format_exc()
            logger.exception("runner: run %s crashed", run_id)
            run.status = "failed"
            run.error = f"{type(e).__name__}: {e}"
            try:
                await emit({"type": "error", "error": "Agent failed. Please retry.", "traceback": tb})
            except Exception:
                logger.debug("runner: failed to write error event for %s", run_id)
        finally:
            try:
                await emit({"type": "done"})
            except Exception:
                logger.debug("runner: failed to write done event for %s", run_id)
            run.finished_at = datetime.now(timezone.utc)
            try:
                await db.execute(
                    update(AgentSession)
                    .where(AgentSession.id == run.session_id)
                    .values(processing=False)
                )
                await db.commit()
            except Exception:
                logger.exception("runner: failed to clear processing flag for session %s", run.session_id)

            try:
                _response_distinct_id = str(run.user_id) if run.user_id else f"session_{run.session_id}"
                posthog.capture(
                    _response_distinct_id,
                    "mason_response_sent",
                    properties={
                        "session_id": run.session_id,
                        "session_type": session_type,
                        "mode": mode,
                        "total_latency_ms": int((time.perf_counter() - started_at) * 1000),
                        "had_products": had_products,
                        "product_count": product_count,
                        "ui_tree_count": ui_tree_count,
                        "run_id": run_id,
                    },
                )
            except Exception:
                logger.debug("posthog capture failed for mason_response_sent", exc_info=True)


async def sweep_zombie_runs() -> None:
    """Mark any leftover running rows from a previous process as failed.

    Called once on app startup. Without this, a Railway redeploy would leave
    rows stuck in ``status='running'`` forever and the per-user concurrency
    cap would be permanently wrong.
    """
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                update(AgentTurnRun)
                .where(AgentTurnRun.status == "running")
                .values(
                    status="failed",
                    error="process_restarted",
                    finished_at=datetime.now(timezone.utc),
                )
                .returning(AgentTurnRun.id, AgentTurnRun.session_id)
            )
            rows = result.fetchall()
            if rows:
                session_ids = {r.session_id for r in rows}
                await db.execute(
                    update(AgentSession)
                    .where(AgentSession.id.in_(session_ids))
                    .values(processing=False)
                )
                logger.warning("runner: swept %d zombie runs on startup", len(rows))
            await db.commit()
    except Exception:
        logger.exception("runner: zombie sweep failed")
