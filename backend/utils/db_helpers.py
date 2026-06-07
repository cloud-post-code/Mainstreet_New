from typing import TypeVar, Type

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


T = TypeVar("T")


async def get_or_404(
    db: AsyncSession,
    model: Type[T],
    obj_id: int,
    *,
    detail: str | None = None,
) -> T:
    """Fetch a row by primary key (`model.id`) or raise 404."""
    result = await db.execute(select(model).where(model.id == obj_id))
    obj = result.scalars().first()
    if not obj:
        raise HTTPException(
            status_code=404,
            detail=detail or f"{model.__name__} not found",
        )
    return obj


async def get_owned_or_404(
    db: AsyncSession,
    model: Type[T],
    obj_id: int,
    user_id: int,
    *,
    owner_field: str = "user_id",
    detail: str | None = None,
) -> T:
    """Fetch a row by primary key constrained to an owner, or raise 404."""
    owner_col = getattr(model, owner_field)
    result = await db.execute(
        select(model).where(model.id == obj_id, owner_col == user_id)
    )
    obj = result.scalars().first()
    if not obj:
        raise HTTPException(
            status_code=404,
            detail=detail or f"{model.__name__} not found",
        )
    return obj


async def verify_session_ownership(
    db: AsyncSession,
    session_id: int,
    user_id: int,
) -> None:
    """Raise 404 if the agent session does not exist or is not owned by user."""
    from db.models import AgentSession

    result = await db.execute(
        select(AgentSession.id).where(
            AgentSession.id == session_id,
            AgentSession.user_id == user_id,
        )
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Session not found")
