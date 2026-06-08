import logging
import traceback
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from db.database import get_db, AsyncSessionLocal
from db.models import AgentSession, AgentPlan, User
from db.schemas import SessionOut, SessionCreate, TurnIn, PlanOut
from auth import get_current_user, get_optional_user
from agent.loop import run_agent_turn
from agent.router_classifier import classify_intent
from agent.suggestions import get_suggestions
from utils.db_helpers import get_owned_or_404, verify_session_ownership
from routers.auth import limiter

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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(AgentSession)
        .where(AgentSession.user_id == current_user.id)
        .order_by(AgentSession.updated_at.desc())
        .limit(50)
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
    return session


@router.post("/guest-session", response_model=SessionOut, status_code=201)
async def create_guest_session(db: AsyncSession = Depends(get_db)):
    """Create an ephemeral session for unauthenticated users. Memory is not saved."""
    session = AgentSession(user_id=None, title="Guest conversation")
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

    Returns the most recent `limit` turns older than `before` (an ISO
    timestamp). Without `before`, returns the most recent page. Response
    is in ascending chronological order; `has_more` indicates whether
    older turns exist beyond the returned page.
    """
    await verify_session_ownership(db, session_id, current_user.id)

    from db.models import AgentTurn
    from datetime import datetime

    # Clamp limit to a sane range — guards against accidental huge fetches
    # while still letting callers tune page size.
    limit = max(1, min(limit, 100))

    q = select(AgentTurn).where(AgentTurn.session_id == session_id)
    if before:
        try:
            cursor = datetime.fromisoformat(before)
            q = q.where(AgentTurn.created_at < cursor)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid `before` cursor")

    # Fetch one extra row so we can tell the client whether more pages exist
    # without a separate count query.
    q = q.order_by(AgentTurn.created_at.desc()).limit(limit + 1)
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
        "next_cursor": page[0].created_at.isoformat() if has_more and page else None,
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


@router.post("/turn")
@limiter.limit("30/minute")
async def agent_turn(
    request: Request,
    body: TurnIn,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    # For authenticated users: verify session ownership
    # For anonymous: verify session has no owner (user_id IS NULL)
    if current_user:
        owner_filter = (AgentSession.user_id == current_user.id)
    else:
        owner_filter = (AgentSession.user_id == None)  # noqa: E711

    result = await db.execute(
        select(AgentSession).where(
            AgentSession.id == body.session_id,
            owner_filter,
        )
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.processing:
        raise HTTPException(status_code=429, detail="A turn is already in progress for this session")

    await db.execute(
        update(AgentSession).where(AgentSession.id == body.session_id).values(processing=True)
    )
    await db.commit()

    user_id = current_user.id if current_user else None
    session_id = body.session_id
    message = body.message
    question_card_id = body.question_card_id
    session_type = getattr(session, "session_type", "shop") or "shop"
    raw_override = (body.mode_override or "").strip().lower() or None
    mode_override = raw_override if raw_override in ("fast", "full") else None

    # Check for an active plan up-front so the classifier can stay on the
    # `full` path for in-flight multi-step work.
    has_active_plan = False
    if session_type != "mason":
        plan_row = (
            await db.execute(
                select(AgentPlan).where(AgentPlan.session_id == session_id).limit(1)
            )
        ).scalars().first()
        has_active_plan = plan_row is not None

    async def stream():
        import json as _json

        # Decide fast vs full BEFORE opening the streaming DB session so the
        # classifier latency overlaps cleanly with the HTTP response start.
        # /mason memory sessions always run on the full memory prompt.
        # User override (Thinking/Fast toggle) skips the classifier entirely.
        if session_type == "mason":
            mode = "full"
            classify_ms = 0
            decided_by = "session_type"
        elif mode_override is not None:
            mode = mode_override
            classify_ms = 0
            decided_by = "user_override"
        else:
            mode, classify_ms = await classify_intent(
                message,
                {
                    "has_active_plan": has_active_plan,
                    "has_active_questionnaire": bool(question_card_id),
                    "last_assistant_action": None,
                },
            )
            decided_by = "classifier"

        # Emit a meta event up-front so the frontend (and ops logs) know
        # which path is running.
        yield _json.dumps({
            "type": "meta",
            "mode": mode,
            "classify_ms": classify_ms,
            "decided_by": decided_by,
        }) + "\n"

        # The request-scoped `db` session is closed when this generator starts
        # streaming, so the streaming turn needs its own session with a
        # lifetime tied to the generator. Without this, the connection leaks
        # back into the pool in a broken state and exhausts it.
        async with AsyncSessionLocal() as stream_db:
            try:
                async for chunk in run_agent_turn(
                    user_message=message,
                    session_id=session_id,
                    user_id=user_id,
                    question_card_id=question_card_id,
                    db=stream_db,
                    mode=mode,
                ):
                    yield chunk
            except Exception:
                logger.exception("agent_turn stream crashed for session %s", session_id)
                yield _json.dumps({
                    "type": "error",
                    "error": "Agent failed. Please retry.",
                }) + "\n"
            finally:
                try:
                    await stream_db.execute(
                        update(AgentSession).where(AgentSession.id == session_id).values(processing=False)
                    )
                    await stream_db.commit()
                except Exception:
                    logger.exception("Failed to clear processing flag for session %s", session_id)

    return StreamingResponse(stream(), media_type="application/x-ndjson")
