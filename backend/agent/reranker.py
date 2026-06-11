"""ZeroEntropy cross-encoder reranker for product search.

Called after RRF fusion + hydration in `_search_products`. The fused candidate
pool is scored against the original user query and reordered by semantic fit.
Failures are raised so the agent sees them (per design choice — surface, do
not silently fall back).
"""
import logging
import time

import httpx

from config import settings

logger = logging.getLogger(__name__)

_RERANK_URL = "https://api.zeroentropy.dev/v1/models/rerank"


class RerankerError(RuntimeError):
    """Raised when the reranker call fails for any reason."""


async def rerank(query: str, docs: list[str], top_n: int) -> tuple[list[int], dict]:
    """Return (doc indices sorted best→worst, telemetry dict).

    Raises RerankerError on timeout, non-2xx, missing config, or malformed
    response. Telemetry includes latency_ms / e2e_latency / inference_latency so
    callers can emit a PostHog event without needing to time the call themselves.
    """
    if not docs:
        raise RerankerError("rerank called with empty docs list")
    if not settings.zeroentropy_api_key:
        raise RerankerError("ZEROENTROPY_API_KEY is not configured")

    body = {
        "model": settings.zeroentropy_rerank_model,
        "query": query,
        "documents": docs,
        "top_n": min(top_n, len(docs)),
        "latency": "fast",
    }
    headers = {
        "Authorization": f"Bearer {settings.zeroentropy_api_key}",
        "Content-Type": "application/json",
    }

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=settings.zeroentropy_rerank_timeout_s) as client:
            resp = await client.post(_RERANK_URL, json=body, headers=headers)
    except httpx.TimeoutException as e:
        raise RerankerError(f"reranker timeout after {settings.zeroentropy_rerank_timeout_s}s") from e
    except httpx.HTTPError as e:
        raise RerankerError(f"reranker http error: {e}") from e
    latency_ms = int((time.perf_counter() - started) * 1000)

    if resp.status_code >= 400:
        raise RerankerError(f"reranker {resp.status_code}: {resp.text[:200]}")

    try:
        payload = resp.json()
        results = payload["results"]
        order = [int(r["index"]) for r in results]
    except (ValueError, KeyError, TypeError) as e:
        raise RerankerError(f"malformed reranker response: {e}") from e

    telemetry = {
        "latency_ms": latency_ms,
        "pool_size": len(docs),
        "top_n": body["top_n"],
        "model": body["model"],
        "e2e_latency": payload.get("e2e_latency"),
        "inference_latency": payload.get("inference_latency"),
        "actual_latency_mode": payload.get("actual_latency_mode"),
    }
    return order, telemetry
