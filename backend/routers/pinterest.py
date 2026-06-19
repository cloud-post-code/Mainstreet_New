"""Pinterest OAuth2 integration — connect boards, import pins as inspo vibes."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import settings
from db.database import get_db
from db.models import User, UserIntegration, Board, BoardVibe
from agent import memory as mem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pinterest", tags=["pinterest"])

PINTEREST_AUTH_URL = "https://www.pinterest.com/oauth/"
PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"
PINTEREST_API_BASE = "https://api.pinterest.com/v5"

PINTEREST_SCOPES = "boards:read,pins:read,user_accounts:read"


def _get_redirect_uri(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/pinterest/callback"


def _get_pinterest_client_id() -> str:
    cid = getattr(settings, "pinterest_client_id", None) or ""
    return cid


def _get_pinterest_client_secret() -> str:
    cs = getattr(settings, "pinterest_client_secret", None) or ""
    return cs


@router.get("/connect")
async def pinterest_connect(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Redirect user to Pinterest OAuth consent page."""
    client_id = _get_pinterest_client_id()
    if not client_id:
        raise HTTPException(status_code=503, detail="Pinterest integration not configured")
    state = f"{current_user.id}:{uuid.uuid4().hex}"
    redirect_uri = _get_redirect_uri(request)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": PINTEREST_SCOPES,
        "state": state,
    }
    from urllib.parse import urlencode
    url = f"{PINTEREST_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url)


@router.get("/callback")
async def pinterest_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Pinterest OAuth callback, exchange code for token."""
    client_id = _get_pinterest_client_id()
    client_secret = _get_pinterest_client_secret()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Pinterest not configured")
    # Parse user_id from state
    try:
        user_id = int(state.split(":")[0])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state")
    redirect_uri = _get_redirect_uri(request)
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            PINTEREST_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            auth=(client_id, client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
    if resp.status_code != 200:
        logger.error("Pinterest token exchange failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(status_code=502, detail="Pinterest token exchange failed")
    token_data = resp.json()
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    expires_at = None
    if expires_in:
        from datetime import timedelta
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    # Fetch Pinterest user info
    async with httpx.AsyncClient() as client:
        me_resp = await client.get(
            f"{PINTEREST_API_BASE}/user_account",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
    meta: dict = {}
    if me_resp.status_code == 200:
        me = me_resp.json()
        meta = {"username": me.get("username"), "profile_image": me.get("profile_image")}

    # Upsert integration
    existing = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == user_id,
            UserIntegration.provider == "pinterest",
        )
    )).scalars().first()
    if existing:
        await db.execute(
            update(UserIntegration)
            .where(UserIntegration.id == existing.id)
            .values(
                access_token=access_token,
                refresh_token=refresh_token,
                token_expires_at=expires_at,
                meta=meta,
                updated_at=datetime.now(timezone.utc),
            )
        )
    else:
        db.add(UserIntegration(
            user_id=user_id,
            provider="pinterest",
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=expires_at,
            meta=meta,
        ))
    await db.commit()
    # Redirect back to the Mason boards page
    frontend_base = str(request.base_url).rstrip("/")
    return RedirectResponse(f"{frontend_base}/mason?tab=saved&pinterest=connected")


@router.get("/status")
async def pinterest_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return whether user has a connected Pinterest account."""
    integration = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.provider == "pinterest",
        )
    )).scalars().first()
    if not integration:
        return {"connected": False}
    return {
        "connected": True,
        "username": (integration.meta or {}).get("username"),
        "profile_image": (integration.meta or {}).get("profile_image"),
    }


@router.delete("/disconnect", status_code=204)
async def pinterest_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integration = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.provider == "pinterest",
        )
    )).scalars().first()
    if integration:
        await db.delete(integration)
        await db.commit()


class ImportOptions(BaseModel):
    board_ids: Optional[list[str]] = None  # None = import all


@router.post("/import")
async def pinterest_import(
    body: ImportOptions,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import Pinterest boards and pins as Main Street boards + vibes."""
    integration = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.provider == "pinterest",
        )
    )).scalars().first()
    if not integration:
        raise HTTPException(status_code=400, detail="Pinterest not connected")
    token = integration.access_token
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        boards_resp = await client.get(f"{PINTEREST_API_BASE}/boards", headers=headers)
    if boards_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not fetch Pinterest boards")
    pinterest_boards = boards_resp.json().get("items", [])
    if body.board_ids:
        pinterest_boards = [b for b in pinterest_boards if b["id"] in body.board_ids]

    imported_boards = []
    for pb in pinterest_boards:
        pb_name = pb.get("name", "Pinterest Board")
        pb_desc = pb.get("description") or "Imported from Pinterest"
        # Create matching Main Street board (skip if name exists)
        try:
            ms_board = await mem.create_board(current_user.id, pb_name, pb_desc, db)
        except Exception:
            # Board already exists — find it
            existing_boards = await mem.list_boards(current_user.id, db)
            ms_board_match = next((b for b in existing_boards if b["name"] == pb_name), None)
            if not ms_board_match:
                continue
            ms_board = ms_board_match
        board_id = ms_board["id"]
        # Set cover image if Pinterest board has one
        if pb.get("media", {}).get("image_cover_url"):
            cover_url = pb["media"]["image_cover_url"]
            from sqlalchemy import update as sa_update
            await db.execute(sa_update(Board).where(Board.id == board_id).values(cover_image_url=cover_url))
            await db.commit()
        # Fetch pins from this board and save as vibes
        async with httpx.AsyncClient(timeout=30) as client:
            pins_resp = await client.get(
                f"{PINTEREST_API_BASE}/boards/{pb['id']}/pins",
                headers=headers,
                params={"page_size": 50, "fields": "id,title,media"},
            )
        vibes_added = 0
        if pins_resp.status_code == 200:
            pins = pins_resp.json().get("items", [])
            for pin in pins:
                image_url = None
                media = pin.get("media", {})
                # Try to get best quality image
                images = media.get("images", {})
                for size in ("originals", "1200x", "600x", "400x300"):
                    if size in images and images[size].get("url"):
                        image_url = images[size]["url"]
                        break
                if not image_url:
                    continue
                label = pin.get("title") or "Pinterest inspo"
                try:
                    await mem.add_vibe_to_board(current_user.id, board_id, label, image_url, "pinterest", db)
                    vibes_added += 1
                except Exception:
                    pass
        imported_boards.append({"board_id": board_id, "name": pb_name, "vibes_added": vibes_added})
    return {"imported": len(imported_boards), "boards": imported_boards}
