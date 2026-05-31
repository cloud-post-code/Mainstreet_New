"""
AI Listing Agent — admin-only endpoints.

  POST /api/admin/listing/upload-image  → uploads image to Railway bucket
  POST /api/admin/listing/draft         → streams sub-agent progress (NDJSON)
  POST /api/admin/listing/approve       → inserts the final Product row
"""
from __future__ import annotations

import json
import mimetypes
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.listing_orchestrator import run_listing_agent
from auth import get_admin_user
from config import settings
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


def _s3_client():
    # Lazy import so the backend boots even if boto3 isn't installed yet.
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.railway_bucket_endpoint or None,
        aws_access_key_id=settings.railway_bucket_access_key or None,
        aws_secret_access_key=settings.railway_bucket_secret_key or None,
        region_name=settings.railway_bucket_region or "us-east-1",
        config=Config(signature_version="s3v4"),
    )


@router.post("/upload-image", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    if not settings.railway_bucket_name:
        raise HTTPException(
            status_code=500,
            detail="Image storage is not configured (RAILWAY_BUCKET_NAME unset).",
        )

    ext = mimetypes.guess_extension(file.content_type or "") or ".jpg"
    key = f"listings/{uuid.uuid4().hex}{ext}"
    body = await file.read()

    try:
        client = _s3_client()
        client.put_object(
            Bucket=settings.railway_bucket_name,
            Key=key,
            Body=body,
            ContentType=file.content_type or "image/jpeg",
            ACL="public-read",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    public_base = settings.railway_bucket_public_base_url.rstrip("/")
    if public_base:
        image_url = f"{public_base}/{key}"
    elif settings.railway_bucket_endpoint:
        image_url = f"{settings.railway_bucket_endpoint.rstrip('/')}/{settings.railway_bucket_name}/{key}"
    else:
        image_url = key

    return UploadResponse(image_url=image_url)


# ── Streaming draft ──────────────────────────────────────────────────────────


@router.post("/draft")
async def draft_listing(
    body: DraftRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    shop = (await db.execute(select(Shop).where(Shop.id == body.shop_id))).scalars().first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    async def event_stream():
        try:
            async for evt in run_listing_agent(
                shop_name=shop.name,
                image_url=body.image_url,
                user_text=body.user_text,
                quantity=body.quantity,
                price=body.price,
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
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)

    out = ProductOut.model_validate(product)
    out.shop_name = shop.name
    return out
