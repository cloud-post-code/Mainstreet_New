"""
Scraper management endpoints.

POST   /api/admin/scrapers              — start a new scraper job
GET    /api/admin/scrapers              — list all jobs + scripts
GET    /api/admin/scrapers/{id}         — job detail
GET    /api/admin/scrapers/{id}/stream  — SSE progress stream
POST   /api/admin/scrapers/{id}/rerun   — re-run saved script without AI rebuild
DELETE /api/admin/scrapers/{id}         — delete job (and script if orphaned)
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from jose import JWTError, jwt
from auth import get_admin_user
from config import settings
from db.database import get_db, AsyncSessionLocal
from db.models import ScraperJob, ScraperScript, Shop, User
from db.schemas import ScraperJobCreate, ScraperJobOut, ScraperVerificationReport

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/scrapers", tags=["scrapers"])

# ---------------------------------------------------------------------------
# In-memory event bus for SSE streaming
# ---------------------------------------------------------------------------

# job_id -> ordered list of all events seen so far (used to replay on reconnect)
_job_streams: dict[int, list[dict]] = {}
# job_id -> live queue for the currently-connected SSE client
_job_queues: dict[int, asyncio.Queue] = {}


def _push_event(job_id: int, event: dict) -> None:
    _job_streams.setdefault(job_id, []).append(event)
    if job_id in _job_queues:
        _job_queues[job_id].put_nowait(event)


def _close_stream(job_id: int) -> None:
    if job_id in _job_queues:
        _job_queues[job_id].put_nowait(None)  # sentinel signals EOF


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _fetch_html(url: str) -> str:
    from agent.upload_safety import assert_public_http_url
    assert_public_http_url(url)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MainStreetBot/1.0)"}
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.text


# ---------------------------------------------------------------------------
# Background job runner
# ---------------------------------------------------------------------------

async def _run_scraper_job(job_id: int, url: str, shop_name_override: Optional[str]) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(ScraperJob, job_id)
        if job is None:
            logger.error("_run_scraper_job: job %d not found", job_id)
            return
        job.status = "running"
        await db.commit()

        try:
            # 1. Fetch HTML
            _push_event(job_id, {"type": "stage", "stage": "fetch", "message": "Fetching page..."})
            html = await _fetch_html(url)

            # 2. Classify seller type
            _push_event(job_id, {"type": "stage", "stage": "classify", "message": "Detecting seller type..."})
            from agent.scraper_builder import classify_seller_type, build_scraper
            seller_type = await classify_seller_type(url, html)
            job.seller_type = seller_type
            _push_event(job_id, {"type": "stage", "stage": "classified", "seller_type": seller_type})

            # 3. Build scraper (yields SSE events)
            rows: Optional[list[dict]] = None
            script_code: Optional[str] = None
            attempts_used: int = 0

            async for event in build_scraper(url, html, seller_type, shop_name_override):
                _push_event(job_id, event)
                if event["type"] == "script_ready":
                    rows = event["rows"]
                    script_code = event["script_code"]
                    attempts_used = event.get("attempt", 1)
                elif event["type"] == "cannot_scrape":
                    job.status = "cannot_scrape"
                    job.failure_reason = event.get("detail") or event.get("message")
                    job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    _push_event(job_id, {"type": "done", "status": "cannot_scrape"})
                    _close_stream(job_id)
                    return

            if not rows or not script_code:
                raise RuntimeError("build_scraper ended without emitting script_ready or cannot_scrape")

            # 4. Persist the generated script
            script = ScraperScript(
                url=url,
                script_code=script_code,
                seller_type=seller_type,
                verified=True,
            )
            db.add(script)
            await db.flush()
            job.script_id = script.id

            # 5. Ingest rows into the product catalogue
            _push_event(job_id, {"type": "stage", "stage": "ingest", "message": "Ingesting products..."})
            from agent.scraper_ingestor import ingest_scraper_output
            report: ScraperVerificationReport = await ingest_scraper_output(db, rows, seller_type)
            report.attempts_used = attempts_used

            # Attach shop_id to job/script when there is exactly one shop in the output
            if report.shops_created + report.shops_updated == 1 and rows:
                inferred_name = rows[0].get("shop_name", "")
                if inferred_name:
                    shop_result = await db.execute(select(Shop).where(Shop.name == inferred_name))
                    shop = shop_result.scalars().first()
                    if shop:
                        script.shop_id = shop.id
                        job.shop_id = shop.id

            job.status = "success"
            job.result_summary = report.model_dump()
            job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            _push_event(job_id, {"type": "success", "report": report.model_dump()})

        except Exception as exc:
            logger.exception("Scraper job %d failed", job_id)
            # Open a fresh session so we don't retry inside a broken transaction.
            async with AsyncSessionLocal() as db2:
                job2 = await db2.get(ScraperJob, job_id)
                if job2:
                    job2.status = "failed"
                    job2.failure_reason = str(exc)
                    job2.finished_at = datetime.now(timezone.utc)
                    await db2.commit()
            _push_event(job_id, {"type": "error", "message": str(exc)})
        finally:
            _close_stream(job_id)


async def _run_scraper_rerun(job_id: int) -> None:
    """Re-execute a job's saved script without rebuilding via the AI."""
    async with AsyncSessionLocal() as db:
        job = await db.get(ScraperJob, job_id)
        if job is None or job.script_id is None:
            logger.error("_run_scraper_rerun: job %d has no script", job_id)
            return
        script = await db.get(ScraperScript, job.script_id)
        if script is None:
            logger.error("_run_scraper_rerun: script %d not found for job %d", job.script_id, job_id)
            return

        job.status = "running"
        await db.commit()

        try:
            _push_event(job_id, {"type": "stage", "stage": "rerun", "message": "Re-running saved script..."})
            from agent.scraper_builder import execute_script
            rows: list[dict] = await execute_script(script.script_code, job.url)

            _push_event(job_id, {"type": "stage", "stage": "ingest", "message": "Ingesting products..."})
            from agent.scraper_ingestor import ingest_scraper_output
            report: ScraperVerificationReport = await ingest_scraper_output(db, rows, script.seller_type or "")
            report.attempts_used = 1

            script.last_run_at = datetime.now(timezone.utc)
            script.last_run_status = "success"
            script.last_error = None

            job.status = "success"
            job.result_summary = report.model_dump()
            job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            _push_event(job_id, {"type": "success", "report": report.model_dump()})

        except Exception as exc:
            logger.exception("Scraper rerun job %d failed", job_id)
            async with AsyncSessionLocal() as db2:
                job2 = await db2.get(ScraperJob, job_id)
                if job2:
                    job2.status = "failed"
                    job2.failure_reason = str(exc)
                    job2.finished_at = datetime.now(timezone.utc)
                    await db2.commit()
                script2 = await db2.get(ScraperScript, job_id)  # noqa: intentional reuse of variable name
                # Actually update the script's last_run fields
                if job2 and job2.script_id:
                    s = await db2.get(ScraperScript, job2.script_id)
                    if s:
                        s.last_run_at = datetime.now(timezone.utc)
                        s.last_run_status = "failed"
                        s.last_error = str(exc)
                        await db2.commit()
            _push_event(job_id, {"type": "error", "message": str(exc)})
        finally:
            _close_stream(job_id)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=ScraperJobOut, status_code=201)
async def start_scraper_job(
    body: ScraperJobCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> ScraperJobOut:
    from agent.upload_safety import assert_public_http_url
    assert_public_http_url(body.url)

    job = ScraperJob(
        url=body.url,
        shop_name=body.shop_name,
        status="pending",
        attempts=0,
    )
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    asyncio.create_task(_run_scraper_job(job_id, body.url, body.shop_name))

    # Re-fetch to return a clean object (avoids detached-instance issues after commit)
    refreshed = await db.get(ScraperJob, job_id)
    return ScraperJobOut.model_validate(refreshed)


@router.get("", response_model=list[ScraperJobOut])
async def list_scraper_jobs(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> list[ScraperJobOut]:
    result = await db.execute(
        select(ScraperJob)
        .options(selectinload(ScraperJob.script))
        .order_by(ScraperJob.created_at.desc())
        .limit(50)
    )
    jobs = result.scalars().all()
    return [ScraperJobOut.model_validate(j) for j in jobs]


@router.get("/{job_id}", response_model=ScraperJobOut)
async def get_scraper_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> ScraperJobOut:
    result = await db.execute(
        select(ScraperJob)
        .options(selectinload(ScraperJob.script))
        .where(ScraperJob.id == job_id)
    )
    job = result.scalars().first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return ScraperJobOut.model_validate(job)


async def _get_admin_from_token_param(token: str, db: AsyncSession) -> User:
    """Validate a bearer token passed as a query parameter (for SSE endpoints
    where EventSource cannot set custom headers)."""
    from sqlalchemy import select as _select
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = int(payload.get("sub", 0))
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(_select(User).where(User.id == user_id))
    user = result.scalars().first()
    if user is None or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/{job_id}/stream")
async def stream_job(
    job_id: int,
    token: str,
    db: AsyncSession = Depends(get_db),
):
    await _get_admin_from_token_param(token, db)

    async def generate():
        # Replay already-seen events first so the client gets full history on reconnect.
        for event in list(_job_streams.get(job_id, [])):
            yield f"data: {json.dumps(event)}\n\n"

        # Check if the job is already in a terminal state.
        job = await db.get(ScraperJob, job_id)
        if job and job.status not in ("pending", "running"):
            yield f"data: {json.dumps({'type': 'done', 'status': job.status})}\n\n"
            return

        # Subscribe to live events.
        q: asyncio.Queue = asyncio.Queue()
        _job_queues[job_id] = q
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    continue
                if event is None:
                    # Sentinel: background job is done.
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            _job_queues.pop(job_id, None)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{job_id}/rerun", response_model=ScraperJobOut)
async def rerun_scraper_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> ScraperJobOut:
    result = await db.execute(
        select(ScraperJob)
        .options(selectinload(ScraperJob.script))
        .where(ScraperJob.id == job_id)
    )
    job = result.scalars().first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.script_id is None:
        raise HTTPException(status_code=400, detail="Job has no saved script; cannot rerun")

    job.status = "pending"
    job.attempts = 0
    job.failure_reason = None
    job.finished_at = None
    await db.commit()

    asyncio.create_task(_run_scraper_rerun(job_id))

    refreshed_result = await db.execute(
        select(ScraperJob)
        .options(selectinload(ScraperJob.script))
        .where(ScraperJob.id == job_id)
    )
    refreshed = refreshed_result.scalars().first()
    return ScraperJobOut.model_validate(refreshed)


@router.delete("/{job_id}", status_code=204, response_model=None)
async def delete_scraper_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> None:
    job = await db.get(ScraperJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    script_id = job.script_id
    await db.delete(job)
    await db.flush()

    # If this was the only job referencing that script, delete the script too.
    if script_id is not None:
        remaining = (await db.execute(
            select(ScraperJob).where(ScraperJob.script_id == script_id).limit(1)
        )).scalars().first()
        if remaining is None:
            orphaned_script = await db.get(ScraperScript, script_id)
            if orphaned_script is not None:
                await db.delete(orphaned_script)

    await db.commit()
