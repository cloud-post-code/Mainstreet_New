"""Backfill product embeddings for hybrid search.

Idempotent: skips rows where embedding IS NOT NULL unless --force.

    cd backend && python -m scripts.backfill_embeddings
    cd backend && python -m scripts.backfill_embeddings --force
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from agent.embeddings import build_canonical_text, embed_texts, vector_literal
from db.database import AsyncSessionLocal
from db.models import Product

_BATCH = 100


async def main(force: bool = False) -> None:
    async with AsyncSessionLocal() as session:
        stmt = select(Product.id, Product.name, Product.shop_name_cached, Product.description)
        if not force:
            stmt = stmt.where(Product.embedding.is_(None))
        rows = (await session.execute(stmt)).all()
        print(f"Embedding {len(rows)} products...")

        total = 0
        for start in range(0, len(rows), _BATCH):
            chunk = rows[start:start + _BATCH]
            texts = [
                build_canonical_text(name=r.name, shop_name=r.shop_name_cached, description=r.description)
                for r in chunk
            ]
            vectors = await embed_texts(texts)
            for r, vec in zip(chunk, vectors):
                if vec is None:
                    continue
                # Cast via the SQL layer to keep this driver-agnostic.
                from sqlalchemy import text as sql_text
                await session.execute(
                    sql_text(
                        "UPDATE products SET embedding = CAST(:v AS vector) WHERE id = :id"
                    ),
                    {"v": vector_literal(vec), "id": r.id},
                )
                total += 1
            await session.commit()
            print(f"  ...{min(start + _BATCH, len(rows))}/{len(rows)} processed, {total} embedded")

        print(f"Done. Embedded {total} products.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-embed every row")
    args = parser.parse_args()
    asyncio.run(main(force=args.force))
