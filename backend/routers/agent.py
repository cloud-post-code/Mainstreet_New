import logging
import traceback
from datetime import datetime, timedelta, timezone
from typing import Optional
import posthog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from posthog import capture
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from db.models import AgentTurn

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


@router.post("/turn")
@limiter.limit("30/minute")
async def agent_turn(
    request: Request,
    body: TurnIn,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    # For authenticated users: verify session ownership.
    # For anonymous: verify session belongs to the shared guest user.
    if current_user:
        owner_filter = (AgentSession.user_id == current_user.id)
    else:
        guest_result = await db.execute(select(User).where(User.email == GUEST_USER_EMAIL))
        guest_user = guest_result.scalars().first()
        if not guest_user:
            raise HTTPException(status_code=404, detail="Session not found")
        owner_filter = (AgentSession.user_id == guest_user.id)

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
        # A prior turn that crashed or was cancelled before the stream's
        # finally block ran can leave processing=True forever. Treat the
        # lock as stale if the row hasn't been touched in 2 minutes.
        stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
        last_touched = session.updated_at
        if last_touched is not None and last_touched.tzinfo is None:
            last_touched = last_touched.replace(tzinfo=timezone.utc)
        if last_touched is None or last_touched > stale_cutoff:
            raise HTTPException(status_code=429, detail="A turn is already in progress for this session")
        logger.warning("Clearing stale processing lock for session %s", body.session_id)

    await db.execute(
        update(AgentSession).where(AgentSession.id == body.session_id).values(processing=True)
    )
    await db.commit()

    user_id = current_user.id if current_user else None
    if user_id is not None:
        capture(
            "agent_turn_sent",
            properties={
                "session_type": getattr(session, "session_type", "shop") or "shop",
                "message_length": len(body.message),
            },
        )
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
        import time as _time

        stream_started_at = _time.perf_counter()

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

        try:
            capture(
                "mason_classifier_decided",
                properties={
                    "session_id": session_id,
                    "session_type": session_type,
                    "chosen_mode": mode,
                    "classify_ms": classify_ms,
                    "decided_by": decided_by,
                    "had_active_plan": has_active_plan,
                    "had_active_questionnaire": bool(question_card_id),
                },
            )
        except Exception:
            logger.debug("posthog capture failed for mason_classifier_decided", exc_info=True)

        # Emit a meta event up-front so the frontend (and ops logs) know
        # which path is running.
        yield _json.dumps({
            "type": "meta",
            "mode": mode,
            "classify_ms": classify_ms,
            "decided_by": decided_by,
        }) + "\n"

        had_products = False
        product_count = 0
        ui_tree_count = 0

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
                    # Sniff ui_tree events to attribute product surface counts
                    # without coupling the loop to the router.
                    if isinstance(chunk, str) and '"ui_tree"' in chunk:
                        try:
                            parsed = _json.loads(chunk)
                            if parsed.get("type") == "ui_tree":
                                ui_tree_count += 1
                                comps = parsed.get("components") or []
                                pc = sum(
                                    1 for c in comps
                                    if isinstance(c, dict) and c.get("type") == "product_card"
                                )
                                if pc:
                                    had_products = True
                                    product_count += pc
                        except Exception:
                            pass
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
                try:
                    capture(
                        "mason_response_sent",
                        properties={
                            "session_id": session_id,
                            "session_type": session_type,
                            "mode": mode,
                            "total_latency_ms": int((_time.perf_counter() - stream_started_at) * 1000),
                            "had_products": had_products,
                            "product_count": product_count,
                            "ui_tree_count": ui_tree_count,
                        },
                    )
                except Exception:
                    logger.debug("posthog capture failed for mason_response_sent", exc_info=True)

    return StreamingResponse(stream(), media_type="application/x-ndjson")
