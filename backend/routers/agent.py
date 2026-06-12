import asyncio
import json as _json
import logging
from datetime import datetime, timezone
from typing import Optional
import posthog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from posthog import capture
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import get_db, AsyncSessionLocal
from db.models import (
    AgentPlan,
    AgentSession,
    AgentTurnEvent,
    AgentTurnRun,
    User,
)
from db.schemas import SessionOut, SessionCreate, TurnIn, PlanOut
from auth import get_current_user, get_optional_user
from agent.runner import (
    MAX_BACKGROUND_RUNS,
    cancel_run,
    start_turn_run,
)
from agent.suggestions import get_suggestions
from utils.db_helpers import get_owned_or_404, verify_session_ownership
from routers.auth import limiter

GUEST_USER_EMAIL = "guest@internal.local"

router = APIRouter(prefix="/api/agent", tags=["agent"])
logger = logging.getLogger(__name__)


@router.get("/suggestions")
async def welcome_suggestions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return {"suggestions": await get_suggestions(current_user.id, db)}


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    session_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from db.models import AgentTurn

    # Offset paging (not a cursor) because the updated_at ordering reshuffles
    # whenever a session gets a new turn, which would invalidate cursors.
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    # Hide sessions that were created but never received a user query — they
    # show up as empty "New conversation" entries cluttering history.
    has_user_turn = (
        select(AgentTurn.id)
        .where(AgentTurn.session_id == AgentSession.id, AgentTurn.role == "user")
        .limit(1)
        .exists()
    )
    stmt = (
        select(AgentSession)
        .where(AgentSession.user_id == current_user.id)
        .where(has_user_turn)
        .order_by(AgentSession.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if session_type in ("shop", "mason"):
        stmt = stmt.where(AgentSession.session_type == session_type)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/sessions", response_model=SessionOut, status_code=201)
async def create_session(
    body: SessionCreate | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session_type = "shop"
    if body and body.session_type in ("shop", "mason"):
        session_type = body.session_type
    session = AgentSession(user_id=current_user.id, session_type=session_type)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    capture("agent_session_created", properties={"session_type": session_type})
    return session


@router.post("/guest-session", response_model=SessionOut, status_code=201)
async def create_guest_session(db: AsyncSession = Depends(get_db)):
    """Create an ephemeral session for unauthenticated users. Memory is not saved."""
    # Resolve (or lazily create) the shared guest user so user_id is never NULL.
    result = await db.execute(select(User).where(User.email == GUEST_USER_EMAIL))
    guest_user = result.scalars().first()
    if not guest_user:
        import secrets
        guest_user = User(
            email=GUEST_USER_EMAIL,
            password_hash=secrets.token_hex(32),  # unusable password — login is blocked
            display_name="Guest",
            is_admin=False,
        )
        db.add(guest_user)
        await db.flush()  # populate guest_user.id without committing

    session = AgentSession(user_id=guest_user.id, title="Guest conversation")
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await get_owned_or_404(
        db, AgentSession, session_id, current_user.id, detail="Session not found"
    )
    await db.delete(session)
    await db.commit()


@router.get("/sessions/{session_id}/turns")
async def get_turns(
    session_id: int,
    limit: int = 20,
    before: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cursor-paginated turn history.

    Returns the most recent `limit` turns older than `before` (the `id` of
    the oldest turn from the previous page, as a string). Without `before`,
    returns the most recent page. Response is in ascending insertion order
    (by primary key); `has_more` indicates whether older turns exist beyond
    the returned page. Ordering uses `id` rather than `created_at` so that
    turns written in the same microsecond (assistant + tool results within
    one streaming turn) preserve a stable, tie-free order across pages.
    """
    await verify_session_ownership(db, session_id, current_user.id)

    from db.models import AgentTurn

    # Clamp limit to a sane range — guards against accidental huge fetches
    # while still letting callers tune page size.
    limit = max(1, min(limit, 100))

    q = select(AgentTurn).where(AgentTurn.session_id == session_id)
    if before:
        try:
            cursor_id = int(before)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid `before` cursor")
        q = q.where(AgentTurn.id < cursor_id)

    # Fetch one extra row so we can tell the client whether more pages exist
    # without a separate count query.
    q = q.order_by(AgentTurn.id.desc()).limit(limit + 1)
    turns_result = await db.execute(q)
    page = turns_result.scalars().all()

    has_more = len(page) > limit
    if has_more:
        page = page[:limit]
    # Hand back oldest-first so the frontend can prepend without re-sorting.
    page.reverse()

    return {
        "turns": [
            {
                "id": t.id,
                "role": t.role,
                "content": t.content,
                "tool_calls": t.tool_calls,
                "tool_results": t.tool_results,
                "created_at": t.created_at.isoformat(),
            }
            for t in page
        ],
        "has_more": has_more,
        # Cursor for fetching the next (older) page — pass back as `before`.
        "next_cursor": str(page[0].id) if has_more and page else None,
    }


@router.get("/sessions/{session_id}/plan", response_model=PlanOut | None)
async def get_plan(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await verify_session_ownership(db, session_id, current_user.id)

    result = await db.execute(
        select(AgentPlan)
        .where(AgentPlan.session_id == session_id)
        .order_by(AgentPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalars().first()
    return plan


async def _resolve_session_for_turn(
    db: AsyncSession,
    session_id: int,
    current_user: Optional[User],
) -> AgentSession:
    """Verify the session belongs to the current user (or the guest user)."""
    if current_user:
        owner_filter = (AgentSession.user_id == current_user.id)
    else:
        guest_result = await db.execute(select(User).where(User.email == GUEST_USER_EMAIL))
        guest_user = guest_result.scalars().first()
        if not guest_user:
            raise HTTPException(status_code=404, detail="Session not found")
        owner_filter = (AgentSession.user_id == guest_user.id)

    result = await db.execute(
        select(AgentSession).where(AgentSession.id == session_id, owner_filter)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/turn", status_code=202)
@limiter.limit("30/minute")
async def agent_turn(
    request: Request,
    body: TurnIn,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Start a background Mason turn.

    The turn runs detached from this HTTP request. Returns the ``run_id``
    immediately; the client should attach via ``GET /api/agent/runs/{run_id}/stream``
    to consume events.
    """
    session = await _resolve_session_for_turn(db, body.session_id, current_user)
    user_id = current_user.id if current_user else None

    raw_override = (body.mode_override or "").strip().lower() or None
    mode_override = raw_override if raw_override in ("fast", "full") else None

    run = await start_turn_run(
        db,
        session=session,
        user_id=user_id,
        message=body.message,
        question_card_id=body.question_card_id,
        mode_override=mode_override,
    )

    if user_id is not None:
        try:
            capture(
                "agent_turn_sent",
                properties={
                    "session_type": getattr(session, "session_type", "shop") or "shop",
                    "message_length": len(body.message),
                    "run_id": run.id,
                },
            )
        except Exception:
            logger.debug("posthog capture failed for agent_turn_sent", exc_info=True)

    return {"run_id": run.id, "session_id": session.id, "status": run.status}


async def _verify_run_owned(
    db: AsyncSession,
    run_id: int,
    current_user: Optional[User],
) -> AgentTurnRun:
    run = (await db.execute(
        select(AgentTurnRun).where(AgentTurnRun.id == run_id)
    )).scalars().first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    # Re-use the session ownership check — runs inherit their session's owner.
    await _resolve_session_for_turn(db, run.session_id, current_user)
    return run


@router.get("/runs/{run_id}/stream")
async def stream_run(
    run_id: int,
    after_seq: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Replay then tail events for a run.

    Emits NDJSON, oldest-first. Closes when the run is no longer ``running``
    and all known events have been flushed. Safe to reconnect by passing the
    last ``seq`` seen as ``after_seq``.
    """
    await _verify_run_owned(db, run_id, current_user)

    async def gen():
        last_seq = after_seq
        # Use a dedicated session so the request session isn't tied up while
        # we poll. ``expire_on_commit=False`` is already configured globally.
        async with AsyncSessionLocal() as poll_db:
            poll_interval = 0.25
            idle_iters = 0
            while True:
                rows = (await poll_db.execute(
                    select(AgentTurnEvent)
                    .where(
                        AgentTurnEvent.run_id == run_id,
                        AgentTurnEvent.seq > last_seq,
                    )
                    .order_by(AgentTurnEvent.seq.asc())
                )).scalars().all()

                if rows:
                    for ev in rows:
                        last_seq = ev.seq
                        yield _json.dumps(ev.payload) + "\n"
                    idle_iters = 0
                else:
                    idle_iters += 1

                run = (await poll_db.execute(
                    select(AgentTurnRun.status).where(AgentTurnRun.id == run_id)
                )).scalar()
                if run != "running":
                    # Drain anything written between the last fetch and the
                    # status flip before closing.
                    tail = (await poll_db.execute(
                        select(AgentTurnEvent)
                        .where(
                            AgentTurnEvent.run_id == run_id,
                            AgentTurnEvent.seq > last_seq,
                        )
                        .order_by(AgentTurnEvent.seq.asc())
                    )).scalars().all()
                    for ev in tail:
                        last_seq = ev.seq
                        yield _json.dumps(ev.payload) + "\n"
                    return

                # Back off slightly when idle to keep DB load low on long thinks.
                await asyncio.sleep(min(poll_interval * (1 + idle_iters * 0.1), 1.0))

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.get("/runs/active")
async def list_active_runs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All in-flight runs for the current user. Drives sidebar status dots."""
    rows = (await db.execute(
        select(
            AgentTurnRun.id,
            AgentTurnRun.session_id,
            AgentTurnRun.status,
            AgentTurnRun.created_at,
        )
        .where(
            AgentTurnRun.user_id == current_user.id,
            AgentTurnRun.status == "running",
        )
        .order_by(AgentTurnRun.created_at.desc())
    )).all()
    return {
        "runs": [
            {
                "run_id": r.id,
                "session_id": r.session_id,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "limit": MAX_BACKGROUND_RUNS,
    }


@router.get("/sessions/{session_id}/active_run")
async def get_active_run_for_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Used when opening a session to know whether to auto-attach."""
    await _resolve_session_for_turn(db, session_id, current_user)
    row = (await db.execute(
        select(AgentTurnRun.id, AgentTurnRun.status)
        .where(
            AgentTurnRun.session_id == session_id,
            AgentTurnRun.status == "running",
        )
        .order_by(AgentTurnRun.created_at.desc())
        .limit(1)
    )).first()
    if row is None:
        return None
    return {"run_id": row.id, "status": row.status}


@router.post("/runs/{run_id}/cancel", status_code=202)
async def cancel_run_endpoint(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _verify_run_owned(db, run_id, current_user)
    cancelled = await cancel_run(run_id)
    return {"cancelled": cancelled}
