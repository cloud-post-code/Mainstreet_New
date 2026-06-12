from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import get_db
from db.models import InboxMessage, AgentSession, AgentTurn, User
from db.schemas import InboxMessageOut, InboxOpenOut
from auth import get_current_user
from utils.db_helpers import get_owned_or_404

router = APIRouter(prefix="/api/inbox", tags=["inbox"])


@router.get("", response_model=list[InboxMessageOut])
async def list_inbox(
    before: int | None = Query(default=None, description="Return messages with id < before (cursor)"),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(InboxMessage)
        .where(InboxMessage.user_id == current_user.id)
        .order_by(InboxMessage.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(InboxMessage.id < before)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/{message_id}/read", response_model=InboxMessageOut)
async def mark_read(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    msg = await get_owned_or_404(
        db, InboxMessage, message_id, current_user.id, detail="Message not found"
    )
    msg.read = True
    await db.commit()
    await db.refresh(msg)
    return msg


@router.post("/{message_id}/open", response_model=InboxOpenOut)
async def open_inbox_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    msg = await get_owned_or_404(
        db, InboxMessage, message_id, current_user.id, detail="Message not found"
    )

    if not msg.session_id:
        session = AgentSession(
            user_id=current_user.id,
            title=msg.title,
        )
        db.add(session)
        await db.flush()

        turn = AgentTurn(
            session_id=session.id,
            role="assistant",
            content=[{"type": "text", "text": msg.body}],
        )
        db.add(turn)
        msg.session_id = session.id

    msg.read = True
    await db.commit()
    await db.refresh(msg)
    return {"session_id": msg.session_id}
