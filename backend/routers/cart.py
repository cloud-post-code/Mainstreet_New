from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from db.database import get_db
from db.models import User
from services import cart as cart_service

router = APIRouter(prefix="/api/cart", tags=["cart"])


class AddItemIn(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1)


class SetQuantityIn(BaseModel):
    quantity: int = Field(ge=0)


@router.get("")
async def get_cart(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await cart_service.view(user_id=user.id, session_id=None, db=db)


@router.post("/items")
async def add_item(
    body: AddItemIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await cart_service.add_item(
        product_id=body.product_id,
        quantity=body.quantity,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    cart = await cart_service.view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.patch("/items/{product_id}")
async def set_item_quantity(
    product_id: int,
    body: SetQuantityIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await cart_service.set_quantity(
        product_id=product_id,
        quantity=body.quantity,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    cart = await cart_service.view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.delete("/items/{product_id}")
async def remove_item(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await cart_service.remove_item(
        product_id=product_id,
        user_id=user.id,
        session_id=None,
        db=db,
    )
    cart = await cart_service.view(user_id=user.id, session_id=None, db=db)
    return {"result": result, "cart": cart}


@router.post("/checkout")
async def checkout(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await cart_service.checkout(user_id=user.id, session_id=None, db=db)
