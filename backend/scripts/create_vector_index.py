"""Create the HNSW index on products.embedding.

Run this once, out-of-band, after deploying. The index build needs more
shared memory than is available during normal app startup on Railway's
managed Postgres, so it lives here instead of in create_tables().

    cd backend && python -m scripts.create_vector_index

Safe to re-run — uses IF NOT EXISTS. Use --concurrently to avoid locking
the products table during the build on a live database.
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import text

from db.database import engine


async def main(concurrently: bool) -> None:
    stmt = (
        "CREATE INDEX {concurrently} IF NOT EXISTS ix_products_embedding_hnsw "
        "ON products USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 8, ef_construction = 32)"
    ).format(concurrently="CONCURRENTLY" if concurrently else "")

    # CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
    async with engine.connect() as conn:
        if concurrently:
            conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        # Keep the build inside Railway Postgres's small /dev/shm.
        await conn.execute(text("SET maintenance_work_mem = '64MB'"))
        await conn.execute(text("SET max_parallel_maintenance_workers = 0"))
        await conn.execute(text(stmt))
        if not concurrently:
            await conn.commit()
    print("HNSW index ready.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrently", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.concurrently))
