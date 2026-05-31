"""
Listing orchestrator — multi-agent loop for AI-assisted product creation.

Stages (each is a separate Claude call so progress is independently streamable):
  1. vision_extract — Claude vision sees the photo, returns structured attributes.
  2. market_research — Claude with web_search tool finds comps and a price range.
  3. description_writer — Claude drafts title, description, summary, tags.
  4. verify — Claude self-checks the assembled draft and emits flags.

Each stage yields {"type":"stage", ...} events; the final draft is emitted as
{"type":"draft", "draft": {...}} and stored under Product.description as JSONB.
"""
from __future__ import annotations

import base64
import json
import mimetypes
from decimal import Decimal
from typing import Any, AsyncGenerator, Optional

import anthropic
import httpx

from config import settings

MODEL = "claude-sonnet-4-6"


def _event(obj: dict) -> dict:
    return obj


def _extract_json(text: str) -> dict:
    """Best-effort: pull the first {...} block out of a model text response."""
    if not text:
        return {}
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}


def _first_tool_input(response, tool_name: str) -> Optional[dict]:
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == tool_name:
            return block.input
    return None


def _collected_text(response) -> str:
    parts = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "\n".join(parts)


async def _fetch_image_as_block(image_url: str) -> dict:
    """Download an image URL and wrap it as an Anthropic image content block."""
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(image_url)
        resp.raise_for_status()
        media_type = resp.headers.get("content-type") or mimetypes.guess_type(image_url)[0] or "image/jpeg"
        media_type = media_type.split(";")[0].strip()
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
        data = base64.standard_b64encode(resp.content).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


# ── Tool schemas for structured outputs ──────────────────────────────────────

VISION_TOOL = {
    "name": "record_vision_attributes",
    "description": "Record structured attributes extracted from the product photo.",
    "input_schema": {
        "type": "object",
        "required": ["category", "candidate_titles"],
        "properties": {
            "category": {"type": "string", "description": "High-level category, e.g. 'ceramic mug', 'leather wallet'."},
            "material": {"type": "string"},
            "color": {"type": "string"},
            "condition": {"type": "string", "description": "new / like-new / used / vintage"},
            "style_tags": {"type": "array", "items": {"type": "string"}},
            "candidate_titles": {"type": "array", "items": {"type": "string"}, "description": "3-5 candidate listing titles."},
            "notable_details": {"type": "string", "description": "Anything else worth noting (engravings, defects, brand marks)."},
        },
    },
}

MARKET_TOOL = {
    "name": "record_market_research",
    "description": "Record price comps and a suggested price.",
    "input_schema": {
        "type": "object",
        "required": ["price_range", "suggested_price"],
        "properties": {
            "comps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "price": {"type": "number"},
                        "url": {"type": "string"},
                        "source": {"type": "string"},
                    },
                },
            },
            "price_range": {
                "type": "object",
                "required": ["low", "mid", "high"],
                "properties": {
                    "low": {"type": "number"},
                    "mid": {"type": "number"},
                    "high": {"type": "number"},
                },
            },
            "suggested_price": {"type": "number"},
            "rationale": {"type": "string"},
        },
    },
}

WRITER_TOOL = {
    "name": "record_listing_copy",
    "description": "Record the final title, description, and tags for the listing.",
    "input_schema": {
        "type": "object",
        "required": ["title", "description_summary", "description_long", "tags"],
        "properties": {
            "title": {"type": "string", "description": "Concise, scannable product title (≤80 chars)."},
            "description_summary": {"type": "string", "description": "1-2 sentence summary."},
            "description_long": {"type": "string", "description": "3-6 sentence detailed description."},
            "tags": {"type": "array", "items": {"type": "string"}},
        },
    },
}

VERIFY_TOOL = {
    "name": "record_verification",
    "description": "Record any quality flags on the draft listing.",
    "input_schema": {
        "type": "object",
        "required": ["flags"],
        "properties": {
            "flags": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["field", "issue"],
                    "properties": {
                        "field": {"type": "string"},
                        "issue": {"type": "string"},
                        "severity": {"type": "string", "description": "info | warn | error"},
                    },
                },
            },
            "overall": {"type": "string", "description": "ok | needs_review"},
        },
    },
}


# ── Stage runners ────────────────────────────────────────────────────────────


async def _run_vision(client: anthropic.Anthropic, image_block: dict, user_text: Optional[str], shop_name: str) -> dict:
    prompt = (
        f"You are the vision-extraction sub-agent for a Main Street listing. "
        f"The seller is '{shop_name}'. Examine the attached photo and extract "
        f"structured product attributes. Call record_vision_attributes exactly once."
    )
    if user_text:
        prompt += f"\n\nSeller notes: {user_text}"

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=[VISION_TOOL],
        tool_choice={"type": "tool", "name": "record_vision_attributes"},
        messages=[
            {
                "role": "user",
                "content": [image_block, {"type": "text", "text": prompt}],
            }
        ],
    )
    return _first_tool_input(response, "record_vision_attributes") or {}


async def _run_market(client: anthropic.Anthropic, vision: dict, user_text: Optional[str]) -> dict:
    query_hint = vision.get("category") or (vision.get("candidate_titles") or [""])[0] or "handmade item"
    prompt = (
        "You are the market-research sub-agent. Use web_search to look up Etsy "
        "and Google Shopping comps for the item described below, then call "
        "record_market_research with the price range and a suggested price.\n\n"
        f"Item: {query_hint}\n"
        f"Attributes: {json.dumps(vision)}\n"
    )
    if user_text:
        prompt += f"Seller notes: {user_text}\n"

    tools = [
        {"type": "web_search_20250305", "name": "web_search", "max_uses": 4},
        MARKET_TOOL,
    ]
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            tools=tools,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _first_tool_input(response, "record_market_research")
        if result:
            return result
    except Exception:
        pass

    # Fallback: no web tool available or web call failed — ask Claude to estimate.
    fallback = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=[MARKET_TOOL],
        tool_choice={"type": "tool", "name": "record_market_research"},
        messages=[
            {
                "role": "user",
                "content": (
                    "Estimate a fair retail price range and suggested price for this "
                    f"item based on general knowledge of similar handmade/boutique goods.\n\n"
                    f"Attributes: {json.dumps(vision)}\n"
                    f"Notes: {user_text or ''}"
                ),
            }
        ],
    )
    return _first_tool_input(fallback, "record_market_research") or {
        "comps": [],
        "price_range": {"low": 10, "mid": 25, "high": 50},
        "suggested_price": 25,
        "rationale": "Fallback estimate — no comps available.",
    }


async def _run_writer(
    client: anthropic.Anthropic,
    vision: dict,
    market: dict,
    user_text: Optional[str],
    shop_name: str,
) -> dict:
    prompt = (
        "You are the description-writer sub-agent for Main Street, a curated "
        "local marketplace. Write a warm, specific listing.\n\n"
        f"Shop: {shop_name}\n"
        f"Vision attributes: {json.dumps(vision)}\n"
        f"Market research: {json.dumps(market)}\n"
    )
    if user_text:
        prompt += f"Seller notes: {user_text}\n"
    prompt += "\nCall record_listing_copy exactly once."

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=[WRITER_TOOL],
        tool_choice={"type": "tool", "name": "record_listing_copy"},
        messages=[{"role": "user", "content": prompt}],
    )
    return _first_tool_input(response, "record_listing_copy") or {}


async def _run_verify(client: anthropic.Anthropic, draft: dict, market: dict) -> dict:
    prompt = (
        "You are the verification sub-agent. Inspect the draft listing and flag "
        "any issues (missing fields, price outside market range, weak title, "
        "tags too generic). Call record_verification exactly once.\n\n"
        f"Draft: {json.dumps(draft, default=str)}\n"
        f"Market range: {json.dumps(market.get('price_range'))}"
    )
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        tools=[VERIFY_TOOL],
        tool_choice={"type": "tool", "name": "record_verification"},
        messages=[{"role": "user", "content": prompt}],
    )
    return _first_tool_input(response, "record_verification") or {"flags": [], "overall": "ok"}


# ── Public entry point ───────────────────────────────────────────────────────


async def run_listing_agent(
    shop_name: str,
    image_url: str,
    user_text: Optional[str],
    quantity: Optional[int],
    price: Optional[Decimal],
) -> AsyncGenerator[dict, None]:
    """Yield NDJSON-ready event dicts as each sub-agent runs."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Pre-fetch image once; reused only by vision stage.
    yield _event({"type": "stage", "stage": "vision", "status": "start"})
    try:
        image_block = await _fetch_image_as_block(image_url)
        vision = await _run_vision(client, image_block, user_text, shop_name)
        yield _event({"type": "stage", "stage": "vision", "status": "done", "data": vision})
    except Exception as e:
        yield _event({"type": "stage", "stage": "vision", "status": "error", "error": str(e)})
        return

    yield _event({"type": "stage", "stage": "market", "status": "start"})
    try:
        market = await _run_market(client, vision, user_text)
        yield _event({"type": "stage", "stage": "market", "status": "done", "data": market})
    except Exception as e:
        market = {"comps": [], "price_range": {"low": 10, "mid": 25, "high": 50}, "suggested_price": 25}
        yield _event({"type": "stage", "stage": "market", "status": "error", "error": str(e), "data": market})

    yield _event({"type": "stage", "stage": "writer", "status": "start"})
    try:
        copy = await _run_writer(client, vision, market, user_text, shop_name)
        yield _event({"type": "stage", "stage": "writer", "status": "done", "data": copy})
    except Exception as e:
        yield _event({"type": "stage", "stage": "writer", "status": "error", "error": str(e)})
        return

    # Assemble draft.
    final_quantity = int(quantity) if quantity and int(quantity) > 0 else 1
    suggested = market.get("suggested_price") or (market.get("price_range") or {}).get("mid") or 25
    final_price = Decimal(str(price)) if price is not None else Decimal(str(suggested))

    draft = {
        "name": copy.get("title") or (vision.get("candidate_titles") or ["Untitled item"])[0],
        "price": str(final_price),
        "quantity": final_quantity,
        "image_url": image_url,
        "tags": copy.get("tags") or vision.get("style_tags") or [],
        "description": {
            "summary": copy.get("description_summary", ""),
            "long": copy.get("description_long", ""),
            "tags": copy.get("tags") or [],
            "vision_attributes": vision,
            "market_comps": market.get("comps", []),
            "price_range": market.get("price_range"),
            "price_rationale": market.get("rationale"),
        },
    }

    yield _event({"type": "stage", "stage": "verify", "status": "start"})
    try:
        verify = await _run_verify(client, draft, market)
        yield _event({"type": "stage", "stage": "verify", "status": "done", "data": verify})
    except Exception as e:
        verify = {"flags": [], "overall": "ok"}
        yield _event({"type": "stage", "stage": "verify", "status": "error", "error": str(e), "data": verify})

    draft["flags"] = verify.get("flags", [])
    yield _event({"type": "draft", "draft": draft})
