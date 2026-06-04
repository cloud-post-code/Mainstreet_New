"""Embedding + query-rewrite + RRF helpers for hybrid product search.

Single source of truth for the canonical product text used by both the
tsvector trigger and the embedding model — keep this aligned with the
trigger in db/database.py.
"""
from __future__ import annotations

import json
import logging
from typing import Iterable

from config import settings

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 1536
_BATCH_SIZE = 100

_openai_client = None
_anthropic_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is not None:
        return _openai_client
    if not settings.openai_api_key:
        return None
    try:
        from openai import AsyncOpenAI
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=5.0)
    except Exception:
        logger.exception("Failed to init OpenAI client")
        return None
    return _openai_client


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client
    if not settings.anthropic_api_key:
        return None
    try:
        import anthropic
        _anthropic_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    except Exception:
        logger.exception("Failed to init Anthropic client")
        return None
    return _anthropic_client


def build_canonical_text(
    *,
    name: str | None,
    shop_name: str | None,
    description: dict | None,
) -> str:
    """Mirror the tsvector trigger's field set so embeddings and lexical
    search index the same text."""
    d = description or {}
    tags = d.get("tags") or []
    if isinstance(tags, list):
        tags_text = " ".join(str(t) for t in tags)
    else:
        tags_text = str(tags)
    parts = [
        name or "",
        shop_name or "",
        d.get("summary") or "",
        tags_text,
        d.get("long") or "",
        d.get("materials") or "",
        d.get("variant") or "",
        d.get("made_in") or "",
    ]
    return " | ".join(p for p in parts if p).strip()


async def embed_text(text: str) -> list[float] | None:
    if not text or not text.strip():
        return None
    client = _get_openai_client()
    if client is None:
        return None
    try:
        resp = await client.embeddings.create(
            model=settings.embedding_model,
            input=text,
        )
        return resp.data[0].embedding
    except Exception:
        logger.warning("embed_text failed", exc_info=True)
        return None


async def embed_texts(texts: list[str]) -> list[list[float] | None]:
    """Batch-embed. Returns one vector per input (None on failure for that
    batch). Empty strings are mapped to None without an API call."""
    if not texts:
        return []
    client = _get_openai_client()
    if client is None:
        return [None] * len(texts)

    out: list[list[float] | None] = [None] * len(texts)
    # Carry indices of non-empty inputs so we can re-place results.
    pending = [(i, t) for i, t in enumerate(texts) if t and t.strip()]
    for start in range(0, len(pending), _BATCH_SIZE):
        chunk = pending[start:start + _BATCH_SIZE]
        inputs = [t for _, t in chunk]
        try:
            resp = await client.embeddings.create(
                model=settings.embedding_model,
                input=inputs,
            )
            for (orig_idx, _), datum in zip(chunk, resp.data):
                out[orig_idx] = datum.embedding
        except Exception:
            logger.warning("embed_texts batch failed", exc_info=True)
            # Leave None for the failed batch; callers fall back to lexical.
    return out


def vector_literal(vec: Iterable[float]) -> str:
    """Format a python sequence as a pgvector literal '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{float(x):.7f}" for x in vec) + "]"


def reciprocal_rank_fusion(
    ranked_lists: list[list[int]],
    k: int = 60,
) -> list[tuple[int, float]]:
    """RRF: score(id) = Σ 1 / (k + rank_in_list). Rank is 1-based.

    Returns (id, score) tuples sorted by score desc.
    """
    scores: dict[int, float] = {}
    for ranked in ranked_lists:
        for rank, pid in enumerate(ranked, start=1):
            scores[pid] = scores.get(pid, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)


_REWRITE_PROMPT = (
    "You rewrite shopping queries for retrieval. Given a user query, return JSON: "
    '{"queries": [literal, synonym_expanded, product_type]}. '
    "literal = the query as-is (lightly cleaned). "
    "synonym_expanded = the same intent with synonyms / related terms added. "
    "product_type = a short phrase describing the kind of product the user likely wants. "
    "Return ONLY the JSON, no prose."
)


async def rewrite_query(query: str) -> list[str]:
    """Return up to 3 query variants (literal + synonyms + product-type).

    Falls back to [query] on any error so search always works.
    """
    q = (query or "").strip()
    if not q:
        return []
    client = _get_anthropic_client()
    if client is None:
        return [q]
    try:
        # Anthropic SDK is sync; this is a fast Haiku call (~100ms).
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=_REWRITE_PROMPT,
            messages=[{"role": "user", "content": q}],
        )
        text = "".join(
            block.text for block in msg.content if getattr(block, "type", None) == "text"
        ).strip()
        # Tolerate code fences.
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
            text = text.strip()
        data = json.loads(text)
        variants = data.get("queries") or []
        cleaned: list[str] = []
        for v in variants:
            if not isinstance(v, str):
                continue
            v = v.strip()
            if v and v not in cleaned:
                cleaned.append(v)
            if len(cleaned) >= 3:
                break
        if q not in cleaned:
            cleaned.insert(0, q)
            cleaned = cleaned[:3]
        return cleaned or [q]
    except Exception:
        logger.warning("rewrite_query failed", exc_info=True)
        return [q]
