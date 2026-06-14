"""
Scraper management endpoints.

POST   /api/admin/scrapers              — start a new scraper job
GET    /api/admin/scrapers              — list all jobs + scripts
GET    /api/admin/scrapers/{id}         — job detail + log
POST   /api/admin/scrapers/{id}/rerun   — re-run saved script without AI rebuild
DELETE /api/admin/scrapers/{id}         — delete job (and script if orphaned)

Events are persisted in ScraperJob.event_log (JSONB list) so they survive
across Railway workers and restarts.  The frontend polls GET /{id} every
2 seconds while status == "running" to get the updated log.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import get_admin_user
from db.database import get_db, AsyncSessionLocal
from db.models import ScraperJob, ScraperScript, Shop, User
from db.schemas import ScraperJobCreate, ScraperJobOut, ScraperVerificationReport

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/scrapers", tags=["scrapers"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _append_log(job_id: int, msg: str, kind: str = "info") -> None:
    """Persist one log line to the DB immediately so the frontend can see it."""
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    entry = {"ts": ts, "msg": msg, "kind": kind}
    async with AsyncSessionLocal() as db:
        job = await db.get(ScraperJob, job_id)
        if job is None:
            return
        current: list = list(job.event_log or [])
        current.append(entry)
        job.event_log = current
        await db.commit()


async def _fetch_html(url: str) -> str:
    from agent.upload_safety import assert_public_http_url
    assert_public_http_url(url)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MainStreetBot/1.0)"}
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=headers) as client:
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
            return
        job.status = "running"
        job.event_log = []
        await db.commit()

    try:
        # 1. Fetch HTML
        await _append_log(job_id, "Fetching page…")
        html = await _fetch_html(url)
        await _append_log(job_id, f"Page fetched ({len(html):,} chars)", "info")

        # 2. Classify seller type
        await _append_log(job_id, "Detecting seller type…")
        from agent.scraper_builder import classify_seller_type, build_scraper
        seller_type = await classify_seller_type(url, html)
        await _append_log(job_id, f"Seller type: {seller_type}", "success")

        # Persist seller_type on the job
        async with AsyncSessionLocal() as db:
            job = await db.get(ScraperJob, job_id)
            if job:
                job.seller_type = seller_type
                await db.commit()

        # 3. Build scraper — async generator
        rows: Optional[list[dict]] = None
        script_code: Optional[str] = None
        attempts_used: int = 0
        cannot_scrape_reason: Optional[str] = None

        async for event in build_scraper(url, html, seller_type, shop_name_override):
            etype = event.get("type")

            if etype == "stage":
                msg = event.get("message") or f"Stage: {event.get('stage')}"
                extra = f" → {event['seller_type']}" if event.get("seller_type") else ""
                await _append_log(job_id, msg + extra)

            elif etype == "thinking":
                if event.get("done"):
                    await _append_log(job_id, f"Script written ({event.get('chars_written', 0):,} chars)")
                else:
                    # Show a brief preview line (not every chunk — throttle to avoid DB spam)
                    chars = event.get("chars_written", 0)
                    if chars % 800 < 200:   # roughly every 800 chars
                        preview = (event.get("preview") or "")[-80:].replace("\n", " ")
                        await _append_log(job_id, f"Writing script… {chars:,} chars: …{preview}", "thinking")

            elif etype == "running_script":
                await _append_log(job_id, event.get("message", "Running script in sandbox…"))

            elif etype == "rows_scraped":
                p, v, s = event.get("products", 0), event.get("rows", 0), event.get("shops", 0)
                await _append_log(job_id, f"Scraped {p} products ({v} variants) across {s} shop(s)", "success")

            elif etype == "attempt_result":
                n = event.get("attempt", "?")
                errs = "; ".join(event.get("errors", []))
                await _append_log(job_id, f"Attempt {n} failed: {errs}", "warn")

            elif etype == "sample_check":
                r = event.get("result", {})
                if r.get("passed"):
                    await _append_log(job_id, "✓ Sample check passed", "success")
                else:
                    await _append_log(job_id, f"Sample check: {r.get('mismatch_reason', 'failed')}", "warn")

            elif etype == "script_ready":
                attempts_used = event.get("attempt", 1)
                rows = event.get("rows")
                script_code = event.get("script_code")
                await _append_log(job_id, f"✓ Script validated on attempt {attempts_used}", "success")

            elif etype == "cannot_scrape":
                cannot_scrape_reason = event.get("detail") or event.get("message")
                await _append_log(job_id, "✗ " + (event.get("message") or "Cannot scrape"), "error")
                if event.get("detail"):
                    await _append_log(job_id, event["detail"], "error")

        if cannot_scrape_reason is not None:
            async with AsyncSessionLocal() as db:
                job = await db.get(ScraperJob, job_id)
                if job:
                    job.status = "cannot_scrape"
                    job.failure_reason = cannot_scrape_reason
                    job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
            return

        if not rows or not script_code:
            raise RuntimeError("build_scraper ended without script_ready or cannot_scrape")

        # 4. Save script + ingest
        await _append_log(job_id, "Ingesting products into database…")
        from agent.scraper_ingestor import ingest_scraper_output
        async with AsyncSessionLocal() as db:
            script = ScraperScript(
                url=url,
                script_code=script_code,
                seller_type=seller_type,
                verified=True,
            )
            db.add(script)
            await db.flush()

            report: ScraperVerificationReport = await ingest_scraper_output(db, rows, seller_type)
            report.attempts_used = attempts_used

            if report.shops_created + report.shops_updated == 1 and rows:
                inferred_name = rows[0].get("shop_name", "")
                if inferred_name:
                    shop_result = await db.execute(select(Shop).where(Shop.name == inferred_name))
                    shop = shop_result.scalars().first()
                    if shop:
                        script.shop_id = shop.id

            job = await db.get(ScraperJob, job_id)
            if job:
                job.status = "success"
                job.script_id = script.id
                if report.shops_created + report.shops_updated == 1 and rows:
                    if inferred_name:
                        sr = await db.execute(select(Shop).where(Shop.name == inferred_name))
                        sh = sr.scalars().first()
                        if sh:
                            job.shop_id = sh.id
                job.result_summary = report.model_dump()
                job.finished_at = datetime.now(timezone.utc)
            await db.commit()

        await _append_log(
            job_id,
            f"✓ Done — {report.shops_created} shops created, "
            f"{report.products_ingested} products, {report.variants_ingested} variants",
            "success",
        )

    except Exception as exc:
        logger.exception("Scraper job %d failed", job_id)
        await _append_log(job_id, f"✗ Error: {exc}", "error")
        async with AsyncSessionLocal() as db:
            job = await db.get(ScraperJob, job_id)
            if job:
                job.status = "failed"
                job.failure_reason = str(exc)
                job.finished_at = datetime.now(timezone.utc)
                await db.commit()


async def _run_scraper_rerun(job_id: int) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(ScraperJob, job_id)
        if job is None or job.script_id is None:
            return
        script = await db.get(ScraperScript, job.script_id)
        if script is None:
            return
        job.status = "running"
        job.event_log = []
        await db.commit()

    try:
        await _append_log(job_id, "Re-running saved script in sandbox…")
        from agent.scraper_builder import execute_script
        rows: list[dict] = await execute_script(script.script_code, job.url)

        p = len({r.get("product_handle") for r in rows if r.get("product_handle")})
        v = len(rows)
        s = len({r.get("shop_name") for r in rows if r.get("shop_name")})
        await _append_log(job_id, f"Scraped {p} products ({v} variants) across {s} shop(s)", "success")
        await _append_log(job_id, "Ingesting products…")

        from agent.scraper_ingestor import ingest_scraper_output
        async with AsyncSessionLocal() as db:
            report: ScraperVerificationReport = await ingest_scraper_output(db, rows, script.seller_type or "")
            report.attempts_used = 1

            job = await db.get(ScraperJob, job_id)
            sc = await db.get(ScraperScript, job.script_id)
            if sc:
                sc.last_run_at = datetime.now(timezone.utc)
                sc.last_run_status = "success"
                sc.last_error = None
            if job:
                job.status = "success"
                job.result_summary = report.model_dump()
                job.finished_at = datetime.now(timezone.utc)
            await db.commit()

        await _append_log(
            job_id,
            f"✓ Done — {report.products_ingested} products, {report.variants_ingested} variants",
            "success",
        )

    except Exception as exc:
        logger.exception("Scraper rerun %d failed", job_id)
        await _append_log(job_id, f"✗ Error: {exc}", "error")
        async with AsyncSessionLocal() as db:
            job = await db.get(ScraperJob, job_id)
            if job:
                job.status = "failed"
                job.failure_reason = str(exc)
                job.finished_at = datetime.now(timezone.utc)
                await db.commit()


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

    job = ScraperJob(url=body.url, shop_name=body.shop_name, status="pending", attempts=0, event_log=[])
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()

    asyncio.create_task(_run_scraper_job(job_id, body.url, body.shop_name))

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
    return [ScraperJobOut.model_validate(j) for j in result.scalars().all()]


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


@router.post("/{job_id}/rerun", response_model=ScraperJobOut)
async def rerun_scraper_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> ScraperJobOut:
    result = await db.execute(
        select(ScraperJob).options(selectinload(ScraperJob.script)).where(ScraperJob.id == job_id)
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
        select(ScraperJob).options(selectinload(ScraperJob.script)).where(ScraperJob.id == job_id)
    )
    return ScraperJobOut.model_validate(refreshed_result.scalars().first())


@router.get("/{job_id}/preview")
async def preview_scraper_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> dict:
    """Return the shops and products that were created by this job."""
    from db.models import Product, ProductVariant, Shop
    from db.schemas import ShopOut, ProductOut

    job = await db.get(ScraperJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    summary = job.result_summary or {}
    shop_ids: list[int] = summary.get("ingested_shop_ids") or []
    product_ids: list[int] = summary.get("ingested_product_ids") or []

    shops: list[dict] = []
    if shop_ids:
        from sqlalchemy import func as sqlfunc
        res = await db.execute(
            select(Shop, sqlfunc.count(Product.id).label("product_count"))
            .outerjoin(Product, Product.shop_id == Shop.id)
            .where(Shop.id.in_(shop_ids))
            .group_by(Shop.id)
            .order_by(Shop.name)
        )
        for shop, cnt in res.all():
            out = ShopOut.model_validate(shop)
            out.product_count = cnt
            shops.append(out.model_dump())

    products: list[dict] = []
    if product_ids:
        from db.schemas import VariantOut, PriceRange
        p_res = await db.execute(
            select(Product, Shop.name.label("shop_name"))
            .join(Shop, Shop.id == Product.shop_id)
            .where(Product.id.in_(product_ids))
            .order_by(Shop.name, Product.name)
        )
        p_rows = p_res.all()
        pid_list = [p.id for p, _ in p_rows]
        v_res = await db.execute(
            select(ProductVariant)
            .where(ProductVariant.product_id.in_(pid_list))
            .order_by(ProductVariant.variant_index)
        )
        variants_by_pid: dict[int, list] = {}
        for v in v_res.scalars().all():
            variants_by_pid.setdefault(v.product_id, []).append(v)

        for product, shop_name in p_rows:
            variants = variants_by_pid.get(product.id, [])
            default_v = next((v for v in variants if v.id == product.default_variant_id), None) or (variants[0] if variants else None)
            prices = [v.price for v in variants if v.price is not None]
            products.append({
                "id": product.id,
                "name": product.name,
                "shop_name": shop_name,
                "handle": product.handle,
                "image_url": default_v.image_url if default_v else None,
                "price": str(min(prices)) if prices else "0",
                "variant_count": len(variants),
                "in_stock": any((v.quantity or 0) > 0 for v in variants),
            })

    return {
        "job_id": job_id,
        "shops": shops,
        "products": products,
        "shop_count": len(shops),
        "product_count": len(products),
    }


@router.delete("/{job_id}/ingested", status_code=200, response_model=None)
async def delete_ingested_by_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
) -> dict:
    """Delete all shops and products that were created by this job.

    Only deletes rows that were CREATED (not updated) by the job.
    Shops are only deleted if they have no remaining products after the product delete.
    """
    from db.models import Product, Shop
    from sqlalchemy import delete as sqldel, func as sqlfunc

    job = await db.get(ScraperJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    summary = job.result_summary or {}
    product_ids: list[int] = summary.get("ingested_product_ids") or []
    shop_ids: list[int] = summary.get("ingested_shop_ids") or []

    products_deleted = 0
    shops_deleted = 0

    if product_ids:
        res = await db.execute(
            sqldel(Product).where(Product.id.in_(product_ids))
        )
        products_deleted = res.rowcount

    # Only delete shops that now have zero products (safe — don't blow away existing data)
    if shop_ids:
        for shop_id in shop_ids:
            count_res = await db.execute(
                select(sqlfunc.count(Product.id)).where(Product.shop_id == shop_id)
            )
            remaining = count_res.scalar() or 0
            if remaining == 0:
                shop = await db.get(Shop, shop_id)
                if shop:
                    await db.delete(shop)
                    shops_deleted += 1

    # Clear the ingested IDs from the job so it can't be double-deleted
    if job.result_summary:
        updated_summary = dict(job.result_summary)
        updated_summary["ingested_product_ids"] = []
        updated_summary["ingested_shop_ids"] = []
        job.result_summary = updated_summary

    await db.commit()

    return {"products_deleted": products_deleted, "shops_deleted": shops_deleted}


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

    if script_id is not None:
        remaining = (await db.execute(
            select(ScraperJob).where(ScraperJob.script_id == script_id).limit(1)
        )).scalars().first()
        if remaining is None:
            orphaned = await db.get(ScraperScript, script_id)
            if orphaned:
                await db.delete(orphaned)

    await db.commit()
