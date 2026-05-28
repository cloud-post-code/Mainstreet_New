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
        await conn.run_sync(Base.metadata.create_all)
        # Create tsvector trigger for products
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
            BEGIN
                NEW.search_vector :=
                    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'summary', '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(
                        array_to_string(ARRAY(SELECT jsonb_array_elements_text(NEW.description->'tags')), ' '), ''
                    )), 'C');
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text("""
            DROP TRIGGER IF EXISTS products_search_vector_trigger ON products;
            CREATE TRIGGER products_search_vector_trigger
            BEFORE INSERT OR UPDATE ON products
            FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();
        """))
