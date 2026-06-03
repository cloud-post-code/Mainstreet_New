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

class ProductOut(BaseModel):
    id: int
    shop_id: int
    shop_name: Optional[str] = None
    name: str
    price: Decimal
    quantity: int
    image_url: Optional[str]
    description: Optional[dict[str, Any]]

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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TurnIn(BaseModel):
    session_id: int
    message: str
    question_card_id: Optional[str] = None  # ties answer back to a question card


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
