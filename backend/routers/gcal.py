"""Google Calendar OAuth2 integration — sync events to the shopping calendar."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from config import settings
from db.database import get_db
from db.models import User, UserIntegration

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gcal", tags=["gcal"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"

GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.readonly"
PROVIDER = "google_calendar"

_RELEVANT_CATEGORIES = {
    "birthday", "anniversary", "holiday", "wedding", "graduation",
    "event", "party", "celebration", "festival", "ceremony",
}


def _get_redirect_uri(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/gcal/callback"


def _client_id() -> str:
    return getattr(settings, "google_client_id", "") or ""


def _client_secret() -> str:
    return getattr(settings, "google_client_secret", "") or ""


def _is_shoppable(event: dict) -> bool:
    """Return True if a calendar event is likely a shoppable occasion."""
    summary = (event.get("summary") or "").lower()
    description = (event.get("description") or "").lower()
    combined = f"{summary} {description}"
    return any(cat in combined for cat in _RELEVANT_CATEGORIES)


def _parse_event_date(event: dict) -> Optional[str]:
    """Extract a yyyy-mm-dd date string from a Google Calendar event."""
    start = event.get("start", {})
    date_str = start.get("date") or start.get("dateTime", "")[:10]
    return date_str if date_str else None


async def _refresh_token_if_needed(integration: UserIntegration, db: AsyncSession) -> str:
    """Return a valid access token, refreshing if expired."""
    if integration.token_expires_at:
        expires = integration.token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires > datetime.now(timezone.utc) + timedelta(minutes=5):
            return integration.access_token

    if not integration.refresh_token:
        raise HTTPException(status_code=401, detail="Google Calendar token expired. Please reconnect.")

    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "refresh_token": integration.refresh_token,
            "grant_type": "refresh_token",
        }, timeout=15)

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not refresh Google token")

    data = resp.json()
    new_access = data.get("access_token", "")
    expires_in = data.get("expires_in", 3600)
    new_expires = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    await db.execute(
        update(UserIntegration)
        .where(UserIntegration.id == integration.id)
        .values(access_token=new_access, token_expires_at=new_expires)
    )
    await db.commit()
    return new_access


@router.get("/connect")
async def gcal_connect(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Redirect user to Google OAuth consent page."""
    cid = _client_id()
    if not cid:
        raise HTTPException(status_code=503, detail="Google Calendar integration not configured")

    state = f"{current_user.id}:{uuid.uuid4().hex}"
    redirect_uri = _get_redirect_uri(request)
    from urllib.parse import urlencode
    params = {
        "client_id": cid,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GCAL_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/callback")
async def gcal_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth callback and exchange code for tokens."""
    cid = _client_id()
    cs = _client_secret()
    if not cid or not cs:
        raise HTTPException(status_code=503, detail="Google Calendar not configured")

    try:
        user_id = int(state.split(":")[0])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state")

    redirect_uri = _get_redirect_uri(request)
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": cid,
            "client_secret": cs,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }, timeout=15)

    if resp.status_code != 200:
        logger.error("Google token exchange failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(status_code=502, detail="Google token exchange failed")

    token_data = resp.json()
    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    existing = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == user_id,
            UserIntegration.provider == PROVIDER,
        )
    )).scalars().first()

    if existing:
        values: dict = {
            "access_token": access_token,
            "token_expires_at": expires_at,
            "updated_at": datetime.now(timezone.utc),
        }
        if refresh_token:
            values["refresh_token"] = refresh_token
        await db.execute(
            update(UserIntegration).where(UserIntegration.id == existing.id).values(**values)
        )
    else:
        db.add(UserIntegration(
            user_id=user_id,
            provider=PROVIDER,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=expires_at,
            meta={},
        ))
    await db.commit()

    frontend_base = str(request.base_url).rstrip("/")
    return RedirectResponse(f"{frontend_base}/mason?tab=dates&gcal=connected")


@router.get("/status")
async def gcal_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return connection status and synced events if connected."""
    integration = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.provider == PROVIDER,
        )
    )).scalars().first()

    if not integration:
        return {"connected": False}

    events = (integration.meta or {}).get("events", [])
    return {"connected": True, "events": events}


@router.post("/sync")
async def gcal_sync(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch upcoming Google Calendar events and cache shoppable ones."""
    integration = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.provider == PROVIDER,
        )
    )).scalars().first()

    if not integration:
        raise HTTPException(status_code=400, detail="Google Calendar not connected")

    access_token = await _refresh_token_if_needed(integration, db)

    # Fetch events from primary calendar, next 12 months
    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=365)).isoformat()

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": 250,
            },
        )

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Google Calendar token invalid. Please reconnect.")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not fetch Google Calendar events")

    items = resp.json().get("items", [])
    events = []
    for item in items:
        date_str = _parse_event_date(item)
        if not date_str:
            continue
        name = item.get("summary", "").strip()
        if not name:
            continue
        events.append({"id": item.get("id", ""), "name": name, "date": date_str})

    # Persist in meta
    await db.execute(
        update(UserIntegration)
        .where(UserIntegration.id == integration.id)
        .values(meta={"events": events})
    )
    await db.commit()

    return {"synced": len(events), "events": events}


@router.delete("/disconnect", status_code=204)
async def gcal_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integration = (await db.execute(
        select(UserIntegration).where(
            UserIntegration.user_id == current_user.id,
            UserIntegration.provider == PROVIDER,
        )
    )).scalars().first()
    if integration:
        await db.delete(integration)
        await db.commit()
