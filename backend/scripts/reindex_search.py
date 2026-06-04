"""Backfill shop_name_cached and rebuild every product's search_vector.

Run after deploying a new trigger definition or after adding the
shop_name_cached column. Touches every product row, but at ~3.5k rows
this finishes in seconds.

    cd backend && python -m scripts.reindex_search
"""
import asyncio
from sqlalchemy import text

from db.database import engine


async def main() -> None:
    async with engine.begin() as conn:
        result = await conn.execute(text("""
            UPDATE products p
            SET shop_name_cached = s.name
            FROM shops s
            WHERE s.id = p.shop_id
              AND (p.shop_name_cached IS DISTINCT FROM s.name)
        """))
        print(f"shop_name_cached backfilled: {result.rowcount} rows")

        # Re-fire the BEFORE UPDATE trigger on every row so search_vector
        # is rebuilt against the current trigger definition.
        result = await conn.execute(text("UPDATE products SET name = name"))
        print(f"search_vector rebuilt: {result.rowcount} rows")


if __name__ == "__main__":
    asyncio.run(main())
