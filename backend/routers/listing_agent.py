"""
AI Listing Agent — admin-only endpoints.

  POST /api/admin/listing/upload-image  → saves image under uploads/, returns URL
  POST /api/admin/listing/draft         → streams sub-agent progress (NDJSON)
  POST /api/admin/listing/approve       → inserts the final Product row (Postgres)
"""
from __future__ import annotations

import json
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.listing_orchestrator import run_listing_agent
from agent.upload_safety import read_capped, validate_image_bytes
from agent.uploads import UPLOAD_SUBDIR, listings_dir, listing_url, public_api_base
from auth import get_admin_user

MAX_IMAGE_BYTES = 8 * 1024 * 1024
from db.database import get_db
from db.models import Product, Shop, User
from db.schemas import ProductOut

router = APIRouter(prefix="/api/admin/listing", tags=["admin", "listing"])


# ── Request / response models ────────────────────────────────────────────────


class DraftRequest(BaseModel):
    shop_id: int
    image_url: str
    user_text: Optional[str] = None
    quantity: Optional[int] = None
    price: Optional[Decimal] = None


class ApproveRequest(BaseModel):
    shop_id: int
    name: str
    price: Decimal
    quantity: int = 1
    image_url: Optional[str] = None
    description: Optional[dict[str, Any]] = Field(default_factory=dict)


class UploadResponse(BaseModel):
    image_url: str


# ── Image upload ─────────────────────────────────────────────────────────────


@router.post("/upload-image", response_model=UploadResponse)
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
):
    body = await read_capped(file, MAX_IMAGE_BYTES)
    _, ext = validate_image_bytes(body)
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_path = listings_dir() / filename
    dest_path.write_bytes(body)

    image_url = listing_url(filename, public_api_base(request))
    return UploadResponse(image_url=image_url)


# ── Streaming draft ──────────────────────────────────────────────────────────


@router.post("/draft")
async def draft_listing(
    body: DraftRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    shop = (await db.execute(select(Shop).where(Shop.id == body.shop_id))).scalars().first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    base_url = public_api_base(request)

    async def event_stream():
        try:
            async for evt in run_listing_agent(
                shop_name=shop.name,
                image_url=body.image_url,
                user_text=body.user_text,
                quantity=body.quantity,
                price=body.price,
                public_api_base_url=base_url,
            ):
                yield json.dumps(evt, default=str) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "error": str(e)}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


# ── Approve & insert ─────────────────────────────────────────────────────────


@router.post("/approve", response_model=ProductOut)
async def approve_listing(
    body: ApproveRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    shop = (await db.execute(select(Shop).where(Shop.id == body.shop_id))).scalars().first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    try:
        price = Decimal(str(body.price))
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="Invalid price")

    quantity = body.quantity if body.quantity and body.quantity > 0 else 1

    product = Product(
        shop_id=shop.id,
        name=name,
        price=price,
        quantity=quantity,
        image_url=body.image_url,
        description=body.description or {},
        shop_name_cached=shop.name,
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)

    out = ProductOut.model_validate(product)
    out.shop_name = shop.name
    return out
