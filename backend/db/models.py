from sqlalchemy import (
    Column, Integer, SmallInteger, String, Boolean, Numeric, Text,
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
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(300), nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    quantity = Column(Integer, default=0, nullable=False)
    image_url = Column(Text)
    description = Column(JSONB)
    search_vector = Column(TSVECTOR)
    embedding = Column(Vector(1536), nullable=True)
    shop_name_cached = Column(String(200))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shop = relationship("Shop", back_populates="products")

    __table_args__ = (
        Index("ix_products_search_vector", "search_vector", postgresql_using="gin"),
        Index(
            "ix_products_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
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


class CartItem(Base):
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    session_id = Column(Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    product = relationship("Product")

    __table_args__ = (
        Index(
            "ix_cart_user_product", "user_id", "product_id", unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "ix_cart_session_product", "session_id", "product_id", unique=True,
            postgresql_where=text("session_id IS NOT NULL AND user_id IS NULL"),
        ),
        CheckConstraint(
            "(user_id IS NOT NULL) OR (session_id IS NOT NULL)",
            name="cart_owner_required",
        ),
    )
