"""Intent classifier — decides whether a turn runs on Fast Mason or Full Mason.

One Haiku 4.5 call per turn. Heuristic-free. Tuned for low latency
(max_tokens=4, temperature=0, hard 800ms timeout, prompt-cached body).
Defaults to "full" on any error or malformed output — safer to overspend
than to ship a bad fast answer.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Literal

import anthropic

from config import settings

logger = logging.getLogger(__name__)

Mode = Literal["fast", "full"]

CLASSIFIER_MODEL = "claude-haiku-4-5-20251001"
CLASSIFIER_TIMEOUT_SECONDS = 0.8

_SYSTEM = """You route shopping messages for Mason, a personal shopping assistant. Reply with exactly one word: `fast` or `full`. No punctuation, no explanation.

**Choose `fast` (this is the preferred answer for simple, specific asks):**
- The user names a specific product, category, or filter and just wants to see options.
- Examples: "show me a candle", "blue mug under $30", "soap", "wool socks", "ceramic vase", "something orange", "linen shirts in medium", "candles", "any new mugs?", "show me what you have for tea".

**Choose `full` only when:**
- The user mentions a recipient ("for my mom", "gift for", "for a 5-year-old").
- The user asks to compare, choose between, or evaluate options ("compare these", "which is better", "help me decide").
- The user is planning something multi-step or multi-item ("gift basket", "outfit for a wedding", "stock my pantry").
- The session has an active questionnaire or plan (the state line will say so).
- The user is asking about cart checkout, removing items, or browsing shops.

When in doubt between fast and full for a short, specific product ask — choose `fast`."""


def _build_state_line(session_state: dict | None) -> str:
    if not session_state:
        return "fresh turn, no active questionnaire or plan"
    bits = []
    if session_state.get("has_active_plan"):
        bits.append("active plan in progress")
    if session_state.get("has_active_questionnaire"):
        bits.append("active questionnaire in progress")
    last = session_state.get("last_assistant_action")
    if last:
        bits.append(f"last assistant action: {last}")
    if not bits:
        return "fresh turn, no active questionnaire or plan"
    return "; ".join(bits)


async def _call_classifier(message: str, state_line: str) -> str:
    """Single Haiku call. Synchronous SDK wrapped in a thread."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def _sync_call() -> str:
        resp = client.messages.create(
            model=CLASSIFIER_MODEL,
            max_tokens=4,
            temperature=0,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": f"Message: {message}\nSession: {state_line}",
                }
            ],
        )
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                return (block.text or "").strip().lower()
        return ""

    return await asyncio.to_thread(_sync_call)


async def classify_intent(
    message: str,
    session_state: dict | None = None,
) -> tuple[Mode, int]:
    """Return (mode, elapsed_ms). Defaults to ("full", elapsed) on any failure.

    session_state is an optional dict with keys:
      - has_active_plan: bool
      - has_active_questionnaire: bool
      - last_assistant_action: str | None
    """
    start = time.perf_counter()
    state_line = _build_state_line(session_state)

    try:
        label = await asyncio.wait_for(
            _call_classifier(message, state_line),
            timeout=CLASSIFIER_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.warning("classify_intent timed out after %dms; defaulting to full", elapsed_ms)
        return ("full", elapsed_ms)
    except Exception:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.exception("classify_intent failed; defaulting to full")
        return ("full", elapsed_ms)

    elapsed_ms = int((time.perf_counter() - start) * 1000)

    if label == "fast":
        return ("fast", elapsed_ms)
    if label == "full":
        return ("full", elapsed_ms)

    logger.warning("classify_intent returned unexpected label %r; defaulting to full", label)
    return ("full", elapsed_ms)
