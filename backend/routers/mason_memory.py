"""REST endpoints powering Mason's Prefs / Saved / Boards tabs."""
import uuid
from typing import Optional, Any, List, Dict
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from db.database import get_db
from db.models import User
from agent import memory as mem
from agent.upload_safety import read_capped, validate_image_bytes
from agent.uploads import public_api_base, upload_root

MAX_BOARD_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB


def _board_covers_dir():
    d = upload_root() / "board_covers"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _board_cover_url(filename: str, base: str) -> str:
    return f"{base.rstrip('/')}/uploads/board_covers/{filename}"

router = APIRouter(prefix="/api/mason", tags=["mason-memory"])


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
    limit: int = Query(default=100, ge=1, le=mem.MAX_SAVED_PRODUCTS),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await mem.list_saved_products(current_user.id, db, limit=limit, offset=offset)


@router.post("/saved-products", status_code=201)
async def save_product_route(
    body: SavedProductIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        created = await mem.save_product(current_user.id, body.product_id, db)
    except ValueError as e:
        status = 400 if "limit reached" in str(e) else 404
        raise HTTPException(status_code=status, detail=str(e))
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


# ── Boards ──────────────────────────────────────────────────────────────────

class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)


class BoardPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None


class BoardProductIn(BaseModel):
    product_id: int


class BoardNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@router.get("/boards")
async def list_boards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    boards = await mem.list_boards(current_user.id, db)
    if not boards:
        # Auto-migrate existing saved products and notes into a default board
        default = await mem.get_or_create_default_board(current_user.id, db)
        await db.commit()
        boards = [default]
    return boards


@router.post("/boards", status_code=201)
async def create_board(
    body: BoardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        board = await mem.create_board(current_user.id, body.name, body.description, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return board


@router.get("/boards/{board_id}")
async def get_board(
    board_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = await mem.get_board(current_user.id, board_id, db)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


@router.patch("/boards/{board_id}")
async def update_board(
    board_id: int,
    body: BoardPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    patch = body.model_dump(exclude_unset=True)
    try:
        board = await mem.update_board(current_user.id, board_id, patch, db)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    await db.commit()
    return board


@router.post("/boards/{board_id}/cover-image")
async def upload_board_cover(
    board_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    board = await mem.get_board(current_user.id, board_id, db)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    body = await read_capped(file, MAX_BOARD_IMAGE_BYTES)
    _, ext = validate_image_bytes(body)
    filename = f"{uuid.uuid4().hex}{ext}"
    (_board_covers_dir() / filename).write_bytes(body)
    image_url = _board_cover_url(filename, public_api_base(request))
    updated = await mem.update_board(current_user.id, board_id, {"cover_image_url": image_url}, db)
    await db.commit()
    return {"cover_image_url": updated["cover_image_url"] if updated else image_url}


@router.delete("/boards/{board_id}", status_code=204)
async def delete_board(
    board_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        ok = await mem.delete_board(current_user.id, board_id, db)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Board not found")
    await db.commit()


@router.post("/boards/{board_id}/products", status_code=201)
async def add_product_to_board(
    board_id: int,
    body: BoardProductIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        newly_saved = await mem.save_product_to_board(current_user.id, board_id, body.product_id, db)
    except ValueError as e:
        status = 404 if "not found" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    await db.commit()
    return {"board_id": board_id, "product_id": body.product_id, "newly_saved": newly_saved}


@router.delete("/boards/{board_id}/products/{product_id}", status_code=204)
async def remove_product_from_board(
    board_id: int,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = await mem.remove_product_from_board(current_user.id, board_id, product_id, db)
    if not ok:
        raise HTTPException(status_code=404, detail="Product not found in board")
    await db.commit()


@router.post("/boards/{board_id}/notes", status_code=201)
async def add_note_to_board(
    board_id: int,
    body: BoardNoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        note = await mem.add_note_to_board(current_user.id, board_id, body.text, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return note


@router.delete("/boards/{board_id}/notes/{note_id}", status_code=204)
async def delete_board_note(
    board_id: int,
    note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = await mem.delete_board_note(current_user.id, board_id, note_id, db)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.commit()
