from sqlalchemy import (
    Column, Integer, BigInteger, SmallInteger, String, Boolean, Numeric, Text,
    ForeignKey, DateTime, func, Index, CheckConstraint, UniqueConstraint, text
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, ARRAY
from sqlalchemy.orm import DeclarativeBase, relationship
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(100))
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sessions = relationship("AgentSession", back_populates="user", cascade="all, delete-orphan", foreign_keys="AgentSession.user_id")
    memory = relationship("UserMemory", back_populates="user", cascade="all, delete-orphan")


class Shop(Base):
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False, unique=True)
    logo_url = Column(Text)
    description = Column(Text)
    website_url = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    products = relationship("Product", back_populates="shop", cascade="all, delete-orphan")


class Product(Base):
    """Parent product. Each Shopify-style handle becomes one row; the
    individual color/size/style choices live in ProductVariant."""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    handle = Column(String(200))
    name = Column(String(300), nullable=False)
    description = Column(JSONB)
    default_variant_id = Column(Integer, ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True)
    search_vector = Column(TSVECTOR)
    embedding = Column(Vector(1536), nullable=True)
    shop_name_cached = Column(String(200))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shop = relationship("Shop", back_populates="products")
    variants = relationship(
        "ProductVariant",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductVariant.variant_index",
        foreign_keys="ProductVariant.product_id",
    )
    default_variant = relationship(
        "ProductVariant",
        foreign_keys=[default_variant_id],
        post_update=True,
    )

    __table_args__ = (
        UniqueConstraint("shop_id", "handle", name="uq_products_shop_handle"),
        Index("ix_products_search_vector", "search_vector", postgresql_using="gin"),
        Index(
            "ix_products_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )


class ProductVariant(Base):
    """One row per Shopify variant — a specific color/size/style pick of a
    parent Product. Single-variant products still get exactly one row here."""
    __tablename__ = "product_variants"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    external_variant_id = Column(BigInteger, index=True, nullable=True)
    variant_index = Column(SmallInteger, nullable=False, default=1)
    option_names = Column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::text[]"))
    option_values = Column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::text[]"))
    price = Column(Numeric(10, 2), nullable=False, default=0)
    quantity = Column(Integer, default=0, nullable=False)
    image_url = Column(Text)
    variant_label = Column(String(300))
    description = Column(JSONB)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship("Product", back_populates="variants", foreign_keys=[product_id])

    __table_args__ = (
        UniqueConstraint("product_id", "external_variant_id", name="uq_variants_product_external"),
        Index("ix_variants_product_index", "product_id", "variant_index"),
        Index("ix_variants_option_values", "option_values", postgresql_using="gin"),
    )


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(300), default="New conversation")
    session_type = Column(String(20), default="shop", nullable=False, server_default="shop")
    processing = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="sessions", foreign_keys=[user_id])
    turns = relationship("AgentTurn", back_populates="session", cascade="all, delete-orphan", order_by="AgentTurn.created_at")
    plans = relationship("AgentPlan", back_populates="session", cascade="all, delete-orphan")


class AgentTurn(Base):
    __tablename__ = "agent_turns"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # user | assistant
    content = Column(JSONB)
    tool_calls = Column(JSONB)
    tool_results = Column(JSONB)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("AgentSession", back_populates="turns")


class AgentPlan(Base):
    __tablename__ = "agent_plans"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False)
    steps = Column(JSONB, nullable=False)  # [{step: 1, description: "...", done: false}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    session = relationship("AgentSession", back_populates="plans")


class AgentTurnRun(Base):
    """A durable, background-executable Mason turn.

    Decouples the work of running a turn from the HTTP request that started it:
    the runner streams events into AgentTurnEvent rows so any subsequent client
    can replay + tail the live response without keeping the original socket open.
    """
    __tablename__ = "agent_turn_runs"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    status = Column(String(20), nullable=False, default="running", server_default="running")
    user_message = Column(Text, nullable=False)
    question_card_id = Column(String(100), nullable=True)
    mode = Column(String(20), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)

    events = relationship("AgentTurnEvent", back_populates="run", cascade="all, delete-orphan", order_by="AgentTurnEvent.seq")

    __table_args__ = (
        Index("ix_turn_runs_user_status", "user_id", "status"),
        Index("ix_turn_runs_session_status", "session_id", "status"),
    )


class AgentTurnEvent(Base):
    """One NDJSON event emitted by the runner for a given AgentTurnRun.

    `seq` is monotonic per run and used as the resume cursor on /runs/{id}/stream.
    """
    __tablename__ = "agent_turn_events"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("agent_turn_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    seq = Column(Integer, nullable=False)
    payload = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    run = relationship("AgentTurnRun", back_populates="events")

    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_turn_events_run_seq"),
    )


class InboxMessage(Base):
    __tablename__ = "inbox_messages"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(300), nullable=False)
    preview = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="inbox_messages")
    session = relationship("AgentSession")


class UserMemory(Base):
    __tablename__ = "user_memory"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key = Column(String(100), nullable=False)
    value = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="memory")

    __table_args__ = (
        Index("ix_user_memory_user_key", "user_id", "key", unique=True),
    )


class UserPreferences(Base):
    """Structured shopping preferences. One row per user."""
    __tablename__ = "user_preferences"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    sizes = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    style_tags = Column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::text[]"))
    quality_price = Column(SmallInteger)
    bulk_individual = Column(SmallInteger)
    discover_known = Column(SmallInteger)
    gift_budget = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    personal_budget = Column(Integer)
    lifestyle = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    likes = Column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::text[]"))
    dislikes = Column(ARRAY(Text), nullable=False, server_default=text("ARRAY[]::text[]"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SavedProduct(Base):
    __tablename__ = "saved_products"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship("Product")

    __table_args__ = (
        UniqueConstraint("user_id", "product_id", name="uq_saved_user_product"),
    )


class TurnUsage(Base):
    """One row per Claude call inside an agent turn — used for cost telemetry."""
    __tablename__ = "turn_usage"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    turn_id = Column(Integer, ForeignKey("agent_turns.id", ondelete="CASCADE"), nullable=True, index=True)
    model = Column(String(64), nullable=False)
    iteration = Column(Integer, nullable=False, default=0)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    cache_read_tokens = Column(Integer, nullable=False, default=0)
    cache_creation_tokens = Column(Integer, nullable=False, default=0)
    thinking_tokens = Column(Integer, nullable=False, default=0)
    estimated_cost_usd = Column(Numeric(10, 6), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class QueryRewriteCache(Base):
    """Cache for Haiku-generated query rewrites. Keyed by normalized query."""
    __tablename__ = "query_rewrite_cache"

    key = Column(String(256), primary_key=True)
    rewrites = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CartItem(Base):
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    variant = relationship("ProductVariant")

    __table_args__ = (
        Index(
            "ix_cart_user_variant", "user_id", "variant_id", unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "ix_cart_session_variant", "session_id", "variant_id", unique=True,
            postgresql_where=text("session_id IS NOT NULL AND user_id IS NULL"),
        ),
        CheckConstraint(
            "(user_id IS NOT NULL) OR (session_id IS NOT NULL)",
            name="cart_owner_required",
        ),
    )


class ScraperScript(Base):
    __tablename__ = "scraper_scripts"

    id              = Column(Integer, primary_key=True)
    shop_id         = Column(Integer, ForeignKey("shops.id", ondelete="SET NULL"), nullable=True)
    url             = Column(Text, nullable=False)
    script_code     = Column(Text, nullable=False)
    seller_type     = Column(String(10), nullable=True)
    verified        = Column(Boolean, default=False, nullable=False)
    last_run_at     = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String(20), nullable=True)
    last_error      = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class ScraperJob(Base):
    __tablename__ = "scraper_jobs"

    id              = Column(Integer, primary_key=True)
    shop_id         = Column(Integer, ForeignKey("shops.id", ondelete="SET NULL"), nullable=True)
    script_id       = Column(Integer, ForeignKey("scraper_scripts.id", ondelete="SET NULL"), nullable=True)
    url             = Column(Text, nullable=False)
    shop_name       = Column(String(200), nullable=True)
    seller_type     = Column(String(10), nullable=True)
    status          = Column(String(20), nullable=False, default="pending", server_default="pending")
    attempts        = Column(Integer, nullable=False, default=0)
    result_summary  = Column(JSONB, nullable=True)
    failure_reason  = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    finished_at     = Column(DateTime(timezone=True), nullable=True)

    script = relationship("ScraperScript", foreign_keys=[script_id])
