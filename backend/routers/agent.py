import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from db.database import get_db
from db.models import AgentSession, AgentPlan, User
from db.schemas import SessionOut, TurnIn, PlanOut
from auth import get_current_user
from agent.loop import run_agent_turn

GUEST_USER_EMAIL = "guest@internal.local"

router = APIRouter(prefix="/api/agent", tags=["agent"])



async def get_optional_user(
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Return the authenticated user or None for anonymous requests."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        from auth import get_current_user as _get
        from fastapi.security import OAuth2PasswordBearer
        from jose import JWTError, jwt
        from config import settings
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = payload.get("sub")
        if not user_id:
            return None
        result = await db.execute(select(User).where(User.id == int(user_id)))
        return result.scalars().first()
    except Exception:
        return None


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AgentSession)
        .where(AgentSession.user_id == current_user.id)
        .order_by(AgentSession.updated_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.post("/sessions", response_model=SessionOut, status_code=201)
async def create_session(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = AgentSession(user_id=current_user.id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
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
    result = await db.execute(
        select(AgentSession).where(
            AgentSession.id == session_id,
            AgentSession.user_id == current_user.id,
        )
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()


@router.get("/sessions/{session_id}/turns")
async def get_turns(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AgentSession).where(AgentSession.id == session_id, AgentSession.user_id == current_user.id)
    )
    if not result.scalars().first():
        raise HTTPException(status_code=404, detail="Session not found")

    from db.models import AgentTurn
    turns_result = await db.execute(
        select(AgentTurn)
        .where(AgentTurn.session_id == session_id)
        .order_by(AgentTurn.created_at.asc())
    )
    turns = turns_result.scalars().all()
    return [
        {
            "role": t.role,
            "content": t.content,
            "tool_calls": t.tool_calls,
            "tool_results": t.tool_results,
            "created_at": t.created_at.isoformat(),
        }
        for t in turns
    ]


@router.get("/sessions/{session_id}/plan", response_model=PlanOut | None)
async def get_plan(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AgentSession).where(AgentSession.id == session_id, AgentSession.user_id == current_user.id)
    )
    if not result.scalars().first():
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(AgentPlan)
        .where(AgentPlan.session_id == session_id)
        .order_by(AgentPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalars().first()
    return plan


@router.post("/turn")
async def agent_turn(
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
        raise HTTPException(status_code=429, detail="A turn is already in progress for this session")

    await db.execute(
        update(AgentSession).where(AgentSession.id == body.session_id).values(processing=True)
    )
    await db.commit()

    user_id = current_user.id if current_user else None

    async def stream_and_release():
        try:
            async for chunk in run_agent_turn(
                user_message=body.message,
                session_id=body.session_id,
                user_id=user_id,
                question_card_id=body.question_card_id,
                db=db,
            ):
                yield chunk
        finally:
            await db.execute(
                update(AgentSession).where(AgentSession.id == body.session_id).values(processing=False)
            )
            await db.commit()

    return StreamingResponse(stream_and_release(), media_type="application/x-ndjson")
