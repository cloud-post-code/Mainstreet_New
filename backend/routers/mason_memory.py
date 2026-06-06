"""REST endpoints powering Mason's Notes / Prefs / Saved tabs.

All endpoints require an authenticated user. Storage lives in `user_memory`
(notes + prefs) and `saved_products` (saved items). The agent reads the same
data on each turn via `agent.memory.load_long_term`, so anything written here
shows up in Mason's context next turn.
"""
from typing import Optional, Any, List, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from db.database import get_db
from db.models import User
from agent import memory as mem

router = APIRouter(prefix="/api/mason", tags=["mason-memory"])


# ── Notes ───────────────────────────────────────────────────────────────────

class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=mem.MAX_NOTE_CHARS)


@router.get("/notes")
async def list_notes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await mem.list_notes(current_user.id, db)


@router.post("/notes", status_code=201)
async def add_note(
    body: NoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        note = await mem.add_note(current_user.id, body.text, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return note


@router.delete("/notes/{key}", status_code=204)
async def delete_note(
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = await mem.delete_note(current_user.id, key, db)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.commit()


# ── Preferences ─────────────────────────────────────────────────────────────

class PrefsPatch(BaseModel):
    sizes: Optional[Dict[str, Any]] = None
    style_tags: Optional[List[str]] = None
    quality_price: Optional[int] = Field(default=None, ge=1, le=5)
    bulk_individual: Optional[int] = Field(default=None, ge=1, le=5)
    discover_known: Optional[int] = Field(default=None, ge=1, le=5)
    gift_budget: Optional[Dict[str, Any]] = None
    personal_budget: Optional[int] = Field(default=None, ge=0)
    lifestyle: Optional[Dict[str, Any]] = None
    likes: Optional[List[str]] = None
    dislikes: Optional[List[str]] = None


@router.get("/prefs")
async def get_prefs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await mem.get_prefs(current_user.id, db)


@router.patch("/prefs")
async def update_prefs(
    body: PrefsPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # exclude_unset so omitted fields are left alone; explicit "" clears.
    out = await mem.set_prefs(current_user.id, body.model_dump(exclude_unset=True), db)
    await db.commit()
    return out


# ── Shipping address ────────────────────────────────────────────────────────

class ShippingPatch(BaseModel):
    name: Optional[str] = None
    line1: Optional[str] = None
    line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None


@router.get("/shipping")
async def get_shipping(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await mem.get_shipping(current_user.id, db)


@router.patch("/shipping")
async def update_shipping(
    body: ShippingPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    out = await mem.set_shipping(current_user.id, body.model_dump(exclude_unset=True), db)
    await db.commit()
    return out


# ── Saved products ──────────────────────────────────────────────────────────

class SavedProductIn(BaseModel):
    product_id: int


@router.get("/saved-products")
async def list_saved(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await mem.list_saved_products(current_user.id, db)


@router.post("/saved-products", status_code=201)
async def save_product_route(
    body: SavedProductIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        created = await mem.save_product(current_user.id, body.product_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await db.commit()
    return {"product_id": body.product_id, "newly_saved": created}


@router.delete("/saved-products/{product_id}", status_code=204)
async def unsave_product_route(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = await mem.unsave_product(current_user.id, product_id, db)
    if not ok:
        raise HTTPException(status_code=404, detail="Saved product not found")
    await db.commit()
