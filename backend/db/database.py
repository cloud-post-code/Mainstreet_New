from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from db.models import Base
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/personal_shopper")

# Railway injects postgres:// — convert to asyncpg scheme
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def create_tables():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_products_embedding_hnsw "
            "ON products USING hnsw (embedding vector_cosine_ops)"
        ))
        # Create tsvector trigger for products. Indexes name + cached shop name
        # (weight A), summary + tags (B), long/materials/variant (C), made_in (D).
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
            BEGIN
                NEW.search_vector :=
                    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.shop_name_cached, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'summary', '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(
                        array_to_string(ARRAY(SELECT jsonb_array_elements_text(NEW.description->'tags')), ' '), ''
                    )), 'B') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'long', '')), 'C') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'materials', '')), 'C') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'variant', '')), 'C') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'made_in', '')), 'D');
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text(
            "DROP TRIGGER IF EXISTS products_search_vector_trigger ON products"
        ))
        await conn.execute(text("""
            CREATE TRIGGER products_search_vector_trigger
            BEFORE INSERT OR UPDATE ON products
            FOR EACH ROW EXECUTE FUNCTION products_search_vector_update()
        """))
        # Keep products.shop_name_cached in sync when a shop is renamed. The
        # UPDATE re-fires the products trigger, which rebuilds search_vector.
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION shops_propagate_name() RETURNS trigger AS $$
            BEGIN
                IF NEW.name IS DISTINCT FROM OLD.name THEN
                    UPDATE products SET shop_name_cached = NEW.name
                    WHERE shop_id = NEW.id;
                END IF;
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text(
            "DROP TRIGGER IF EXISTS shops_propagate_name_trigger ON shops"
        ))
        await conn.execute(text("""
            CREATE TRIGGER shops_propagate_name_trigger
            AFTER UPDATE ON shops
            FOR EACH ROW EXECUTE FUNCTION shops_propagate_name()
        """))
