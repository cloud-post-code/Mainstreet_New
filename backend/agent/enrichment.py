"""Product enrichment pipeline.

Runs GPT-4o-mini on unenriched products to produce:
  1. Context summary (≤100 words)
  2. 6 jobs-to-be-done (3 end-user + 3 gift-giver)
  3. 2 user personas (end-user + gift-giver)
  4. 20 SEO keywords

Results are stored in products.enrichment_data (JSONB).
The 20 keywords replace products.description['tags'].
A new embedding is generated from enriched canonical text.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import openai
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import Product

log = logging.getLogger(__name__)

_BATCH_SIZE = 10  # GPT rate-limit safe batch size

# ── Prompt templates (verbatim as specified) ──────────────────────────────────

_CONTEXT_PROMPT = """\
You are an automatic product enrichment system.

Use ONLY the provided product data.
Do NOT invent details.
Maximum 100 words.

PRODUCT:
Name: {product_name}
Category: {category_name}
Description: {description}
Images:
{images}

Return ONLY:
CONTEXT: ..."""

_JOBS_PROMPT = """\
Based ONLY on the context below, generate 6 jobs.

CONTEXT:
{context}

FORMAT:
END_USER_JOB_1: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome].
END_USER_JOB_2: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome].
END_USER_JOB_3: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome].

GIFT_GIVER_JOB_1: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome].
GIFT_GIVER_JOB_2: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome].
GIFT_GIVER_JOB_3: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome]."""

_PERSONAS_PROMPT = """\
Using ONLY this context:

{context}

FORMAT:
END_USER_PERSONA:
IDENTITY: [max 25 words]
DEMOGRAPHICS: [max 25 words]
PSYCHOGRAPHICS: [max 25 words]
BEHAVIORS: [max 25 words]
GOALS_AND_NEEDS: [max 25 words]
PAIN_POINTS: [max 25 words]
MOTIVATIONS: [max 25 words]
EXAMPLE_QUERY: [short example]

GIFT_GIVER_PERSONA:
IDENTITY: [max 25 words]
DEMOGRAPHICS: [max 25 words]
PSYCHOGRAPHICS: [max 25 words]
BEHAVIORS: [max 25 words]
GOALS_AND_NEEDS: [max 25 words]
PAIN_POINTS: [max 25 words]
MOTIVATIONS: [max 25 words]
EXAMPLE_QUERY: [short example]"""

_KEYWORDS_PROMPT = """\
Using the provided product context, jobs-to-be-done, and user personas:

{context}

Generate EXACTLY 20 SEO search keywords that realistic consumers would type when searching for this exact product.

OUTPUT RULES:
- Exactly 20 keywords
- One keyword per line
- Single real English word only
- Letters A–Z only
- No spaces, hyphens, underscores, numbers, or symbols
- No explanations or extra text

CONTENT RULES:
- Each keyword must be clearly and directly tied to this specific product
- Keywords must reflect high-intent search behavior
- Do NOT use generic descriptors (cute, unique, quality, handmade)
- Do NOT use broad category fillers
- Do NOT use marketing or sales terms
- Do NOT invent, merge, or abbreviate words

REQUIRED DISTRIBUTION:
- 4 core product-type terms
- 4 style or aesthetic descriptors
- 4 use-case or occasion terms
- 4 audience or identity terms
- 4 real synonyms or variants users actually search

Return keywords only, one per line."""


async def _gpt(client: openai.AsyncOpenAI, prompt: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=800,
    )
    return (response.choices[0].message.content or "").strip()


def _extract_keywords(raw: str) -> list[str]:
    words = []
    for line in raw.splitlines():
        w = line.strip()
        if w and w.isalpha():
            words.append(w.lower())
    return words[:20]


async def enrich_product(product: Product, client: openai.AsyncOpenAI) -> dict[str, Any]:
    """Run the 4-step enrichment chain for one product. Returns enrichment_data dict."""
    name = product.name or ""
    desc = product.description or {}
    summary = desc.get("summary", "") if isinstance(desc, dict) else ""
    tags = desc.get("tags", []) if isinstance(desc, dict) else []
    category = (tags[0] if tags else "") or ""
    description_text = summary or name

    # Step 1 — context
    context_raw = await _gpt(client, _CONTEXT_PROMPT.format(
        product_name=name,
        category_name=category,
        description=description_text,
        images="(no images provided)",
    ))
    context = context_raw.replace("CONTEXT:", "").strip()

    # Step 2 — jobs (context feeds in)
    jobs_raw = await _gpt(client, _JOBS_PROMPT.format(context=context))

    # Step 3 — personas (context + jobs feed in)
    combined_context = f"{context}\n\nJOBS:\n{jobs_raw}"
    personas_raw = await _gpt(client, _PERSONAS_PROMPT.format(context=combined_context))

    # Step 4 — keywords (context + jobs + personas feed in)
    full_context = f"{combined_context}\n\nPERSONAS:\n{personas_raw}"
    keywords_raw = await _gpt(client, _KEYWORDS_PROMPT.format(context=full_context))
    keywords = _extract_keywords(keywords_raw)

    return {
        "context": context,
        "jobs": jobs_raw,
        "personas": personas_raw,
        "keywords": keywords,
    }


async def run_enrichment_batch(
    db: AsyncSession,
    *,
    status_store: dict,
) -> None:
    """Fetch unenriched products and enrich them. Updates status_store in place."""
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

    # Count total unenriched
    from sqlalchemy import func as sqlfunc
    count_result = await db.execute(
        select(sqlfunc.count(Product.id)).where(Product.enriched_at.is_(None))
    )
    total = count_result.scalar() or 0
    status_store.update({"total": total, "done": 0, "errors": 0, "running": True})

    offset = 0
    while True:
        batch_result = await db.execute(
            select(Product)
            .where(Product.enriched_at.is_(None))
            .order_by(Product.id)
            .limit(_BATCH_SIZE)
            .offset(offset)
        )
        products = list(batch_result.scalars().all())
        if not products:
            break

        for product in products:
            try:
                enrichment = await enrich_product(product, client)

                # Update description.tags with enriched keywords
                desc = dict(product.description) if isinstance(product.description, dict) else {}
                desc["tags"] = enrichment["keywords"]

                # Generate new embedding from enriched canonical text
                from agent.embeddings import embed_texts, build_canonical_text
                canonical = build_canonical_text(
                    name=product.name or "",
                    shop_name=product.shop_name_cached or "",
                    description=desc,
                )
                vecs = await embed_texts([canonical])
                new_embedding = vecs[0] if vecs else None

                now = datetime.now(timezone.utc)
                await db.execute(
                    update(Product)
                    .where(Product.id == product.id)
                    .values(
                        description=desc,
                        enrichment_data=enrichment,
                        enriched_at=now,
                        **({"embedding": new_embedding} if new_embedding else {}),
                    )
                )
                await db.commit()
                status_store["done"] += 1
            except Exception as exc:
                log.warning("Enrichment failed for product %s: %s", product.id, exc)
                status_store["errors"] += 1

        offset += _BATCH_SIZE

    status_store["running"] = False
