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

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=30,
    pool_recycle=1800,
    pool_timeout=10,
)
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
        # create_all only creates missing tables — ADD COLUMN by hand for
        # existing deployments. Safe to re-run thanks to IF NOT EXISTS.
        await conn.execute(text(
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(1536)"
        ))
        await conn.execute(text(
            "ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS session_type varchar(20) NOT NULL DEFAULT 'shop'"
        ))
        # Variant-aware product model. The columns may exist (Numeric/Integer
        # NOT NULL) on older deployments — drop the NOT NULL constraints so
        # the backfill can move data into product_variants and leave the
        # parent rows empty. The columns themselves are dropped by the
        # migration script after the backfill completes.
        await conn.execute(text(
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS handle varchar(200)"
        ))
        await conn.execute(text(
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_variant_id integer"
        ))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'products' AND column_name = 'price'
                ) THEN
                    EXECUTE 'ALTER TABLE products ALTER COLUMN price DROP NOT NULL';
                END IF;
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'products' AND column_name = 'quantity'
                ) THEN
                    EXECUTE 'ALTER TABLE products ALTER COLUMN quantity DROP NOT NULL';
                END IF;
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'cart_items' AND column_name = 'product_id'
                ) THEN
                    EXECUTE 'ALTER TABLE cart_items ALTER COLUMN product_id DROP NOT NULL';
                END IF;
            END$$;
        """))
        await conn.execute(text(
            "ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS variant_id integer REFERENCES product_variants(id) ON DELETE CASCADE"
        ))
        # FK to product_variants is set up below once the table is ensured
        # to exist (Base.metadata.create_all already handled creation).
        # NOTE: the HNSW index on products.embedding is intentionally NOT created
        # here. Building it requires more shared memory than Railway's managed
        # Postgres provides by default (we hit DiskFullError resizing the shm
        # segment). Semantic search works without it (seq scan), so create the
        # index once out-of-band via scripts/create_vector_index.py.
        # Create tsvector trigger for products. Indexes name + cached shop name
        # (weight A), summary + tags (B), long/materials/variant (C), made_in (D).
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
            DECLARE
                option_text text;
                tags_text text;
            BEGIN
                -- Aggregate all variant option_values for the parent so a
                -- search for "red tape dispenser" still finds the parent.
                SELECT coalesce(string_agg(array_to_string(option_values, ' '), ' '), '')
                  INTO option_text
                  FROM product_variants
                 WHERE product_id = NEW.id;
                -- tags may be a JSON array (preferred) or a comma-delimited
                -- string from older imports; tolerate both, ignore other shapes.
                IF jsonb_typeof(NEW.description->'tags') = 'array' THEN
                    tags_text := array_to_string(
                        ARRAY(SELECT jsonb_array_elements_text(NEW.description->'tags')), ' '
                    );
                ELSIF jsonb_typeof(NEW.description->'tags') = 'string' THEN
                    tags_text := NEW.description->>'tags';
                ELSE
                    tags_text := '';
                END IF;
                NEW.search_vector :=
                    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.shop_name_cached, '')), 'A') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'summary', '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(tags_text, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(option_text, '')), 'B') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'long', '')), 'C') ||
                    setweight(to_tsvector('english', coalesce(NEW.description->>'materials', '')), 'C') ||
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
        # Variant inserts/updates/deletes invalidate the parent's
        # search_vector (which embeds the variant option_values). The cheapest
        # way to refresh is a no-op UPDATE on the parent row, which re-fires
        # products_search_vector_update.
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION variants_touch_parent() RETURNS trigger AS $$
            BEGIN
                IF (TG_OP = 'DELETE') THEN
                    UPDATE products SET name = name WHERE id = OLD.product_id;
                    RETURN OLD;
                ELSE
                    UPDATE products SET name = name WHERE id = NEW.product_id;
                    RETURN NEW;
                END IF;
            END
            $$ LANGUAGE plpgsql;
        """))
        await conn.execute(text(
            "DROP TRIGGER IF EXISTS variants_touch_parent_trigger ON product_variants"
        ))
        await conn.execute(text("""
            CREATE TRIGGER variants_touch_parent_trigger
            AFTER INSERT OR UPDATE OR DELETE ON product_variants
            FOR EACH ROW EXECUTE FUNCTION variants_touch_parent()
        """))
        # Scraper tables — only add columns if the table already existed before
        # create_all ran (i.e. this is an upgrade on an older deployment).
        # On fresh deployments create_all builds the full schema above and these
        # are safe no-ops thanks to IF NOT EXISTS on both table and column.
        await conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scraper_scripts') THEN
                    EXECUTE 'ALTER TABLE scraper_scripts ADD COLUMN IF NOT EXISTS seller_type varchar(10)';
                    EXECUTE 'ALTER TABLE scraper_scripts ADD COLUMN IF NOT EXISTS last_run_at timestamptz';
                    EXECUTE 'ALTER TABLE scraper_scripts ADD COLUMN IF NOT EXISTS last_run_status varchar(20)';
                    EXECUTE 'ALTER TABLE scraper_scripts ADD COLUMN IF NOT EXISTS last_error text';
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scraper_jobs') THEN
                    EXECUTE 'ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS seller_type varchar(10)';
                    EXECUTE 'ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS shop_name varchar(200)';
                END IF;
            END$$;
        """))
