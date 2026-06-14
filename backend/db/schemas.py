from pydantic import BaseModel, EmailStr, field_validator
from typing import Any, Optional
from decimal import Decimal
from datetime import datetime


# --- Auth ---

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    display_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("Password must be at least 12 characters")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    display_name: Optional[str]
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# --- Shops ---

class ShopOut(BaseModel):
    id: int
    name: str
    logo_url: Optional[str]
    description: Optional[str]
    website_url: Optional[str]
    product_count: Optional[int] = None

    model_config = {"from_attributes": True}


class ShopCreate(BaseModel):
    name: str
    logo_url: Optional[str] = None
    description: Optional[str] = None
    website_url: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Shop name is required")
        return v.strip()


# --- Products ---

class VariantOut(BaseModel):
    id: int
    product_id: int
    external_variant_id: Optional[int] = None
    variant_index: int
    option_names: list[str] = []
    option_values: list[str] = []
    price: Decimal
    quantity: int
    image_url: Optional[str] = None
    variant_label: Optional[str] = None
    description: Optional[dict[str, Any]] = None

    model_config = {"from_attributes": True}


class PriceRange(BaseModel):
    min: Decimal
    max: Decimal


class ProductOut(BaseModel):
    id: int
    shop_id: int
    parent_store: Optional[str] = None
    shop_name: Optional[str] = None
    handle: Optional[str] = None
    name: str
    description: Optional[dict[str, Any]] = None
    default_variant_id: Optional[int] = None
    variants: list[VariantOut] = []
    price_range: Optional[PriceRange] = None
    in_stock: bool = False
    image_url: Optional[str] = None

    model_config = {"from_attributes": True}


class ProductSearchParams(BaseModel):
    query: Optional[str] = None
    shop_id: Optional[int] = None
    min_price: Optional[Decimal] = None
    max_price: Optional[Decimal] = None
    in_stock_only: bool = False
    limit: int = 20
    offset: int = 0


# --- Agent ---

class SessionOut(BaseModel):
    id: int
    title: str
    session_type: str = "shop"
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SessionCreate(BaseModel):
    session_type: Optional[str] = "shop"


class TurnIn(BaseModel):
    session_id: int
    message: str
    question_card_id: Optional[str] = None  # ties answer back to a question card
    # Optional user override: "fast" forces Fast Mason, "full" forces Full Mason
    # (no classifier call). None = auto (classifier decides).
    mode_override: Optional[str] = None


class PlanOut(BaseModel):
    id: int
    session_id: int
    steps: list[dict[str, Any]]
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- Admin ---

class ImportResult(BaseModel):
    rows_added: int
    rows_updated: int
    errors: list[dict[str, Any]]


class AdminProductsPage(BaseModel):
    items: list[ProductOut]
    total: int
    limit: int
    offset: int


# --- Scraper ---

class ScraperJobCreate(BaseModel):
    url: str
    shop_name: Optional[str] = None  # optional override; auto-detected if absent


class SampleProduct(BaseModel):
    name: str
    price: str
    image_url: str
    shop_name: str


class SampleVerificationResult(BaseModel):
    passed: bool
    sample_results: list[dict]
    mismatch_reason: Optional[str] = None


class ScraperVerificationReport(BaseModel):
    seller_type: str = ""
    shops_created: int = 0
    shops_updated: int = 0
    products_ingested: int = 0
    products_updated: int = 0
    variants_ingested: int = 0
    fields_found: list[str] = []
    fields_missing: list[str] = []
    sample_products: list[SampleProduct] = []
    sample_verification: Optional[dict] = None
    errors: list[dict] = []
    confidence: str = "low"  # "high" | "medium" | "low"
    attempts_used: int = 1


class ScraperScriptOut(BaseModel):
    id: int
    shop_id: Optional[int]
    url: str
    seller_type: Optional[str]
    verified: bool
    last_run_at: Optional[datetime]
    last_run_status: Optional[str]
    last_error: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class ScraperJobOut(BaseModel):
    id: int
    shop_id: Optional[int]
    script_id: Optional[int]
    url: str
    shop_name: Optional[str]
    seller_type: Optional[str]
    status: str
    attempts: int
    result_summary: Optional[dict] = None
    failure_reason: Optional[str]
    event_log: Optional[list] = None
    created_at: datetime
    finished_at: Optional[datetime]
    script: Optional[ScraperScriptOut] = None
    model_config = {"from_attributes": True}


# --- Inbox ---

class InboxMessageOut(BaseModel):
    id: int
    user_id: int
    session_id: Optional[int]
    title: str
    preview: str
    body: str
    read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class InboxOpenOut(BaseModel):
    session_id: int
