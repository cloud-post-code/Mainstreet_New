"""Generate AI placeholder cover images for boards using OpenAI image generation."""
from __future__ import annotations

import uuid
import logging
from pathlib import Path
from typing import Any

import openai

from config import settings
from agent.uploads import upload_root, public_api_base

log = logging.getLogger(__name__)

_STYLE = (
    "Aesthetic lifestyle mood board cover photo. "
    "Warm, editorial, magazine-quality. No text, no words, no labels."
)


def _board_covers_dir() -> Path:
    d = upload_root() / "board_covers"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _board_cover_url(filename: str) -> str:
    base = public_api_base()
    return f"{base.rstrip('/')}/uploads/board_covers/{filename}"


def _build_prompt(name: str, description: str | None) -> str:
    subject = name.strip()
    if description:
        subject = f"{subject} — {description.strip()}"
    return (
        f"Create a single cohesive cover image for a shopping board called '{subject}'. "
        f"{_STYLE}"
    )


async def generate_board_cover(board_id: int, name: str, description: str | None) -> str | None:
    """
    Generate a cover image for a board via OpenAI and save it to disk.
    Returns the public URL or None on failure.
    """
    if not settings.openai_api_key:
        log.warning("board_image: OPENAI_API_KEY not set, skipping generation")
        return None

    prompt = _build_prompt(name, description)
    try:
        client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            n=1,
            size="1024x1024",
            quality="standard",
            response_format="b64_json",
        )
        b64 = response.data[0].b64_json
        if not b64:
            log.warning("board_image: empty b64_json from OpenAI for board %s", board_id)
            return None

        import base64
        image_bytes = base64.b64decode(b64)
        filename = f"{uuid.uuid4().hex}.png"
        (_board_covers_dir() / filename).write_bytes(image_bytes)
        url = _board_cover_url(filename)
        log.info("board_image: generated cover for board %s → %s", board_id, filename)
        return url

    except openai.OpenAIError as exc:
        log.warning("board_image: OpenAI generation failed for board %s: %s", board_id, exc)
        return None
    except Exception as exc:  # noqa: BLE001
        log.warning("board_image: unexpected error for board %s: %s", board_id, exc)
        return None


async def generate_and_save_board_cover(
    board_id: int,
    name: str,
    description: str | None,
    session_maker: Any,
) -> None:
    """
    Background task: generate cover image and persist cover_image_url to the board row.
    Uses a fresh DB session (via session_maker) so it doesn't interfere with the request session.
    """
    from sqlalchemy import select
    from db.models import Board

    url = await generate_board_cover(board_id, name, description)
    if not url:
        return

    async with session_maker() as db:
        try:
            result = await db.execute(select(Board).where(Board.id == board_id))
            board = result.scalars().first()
            if board and not board.cover_image_url:
                board.cover_image_url = url
                await db.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("board_image: failed to save cover_image_url for board %s: %s", board_id, exc)
            await db.rollback()
