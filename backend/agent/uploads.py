"""Shared upload directory + public URL helpers for the listing flows."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import Request

from config import settings

UPLOAD_SUBDIR = "listings"
SHOP_LOGO_SUBDIR = "shops"


def upload_root() -> Path:
    root = Path(settings.upload_dir)
    if not root.is_absolute():
        root = Path(__file__).resolve().parent.parent / root
    return root


def listings_dir() -> Path:
    d = upload_root() / UPLOAD_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def shops_dir() -> Path:
    d = upload_root() / SHOP_LOGO_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def public_api_base(request: Optional[Request] = None) -> str:
    if settings.public_api_url:
        return settings.public_api_url.rstrip("/")
    railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway_domain:
        return f"https://{railway_domain}"
    if request is not None:
        return str(request.base_url).rstrip("/")
    return ""


def listing_url(filename: str, base: str) -> str:
    return f"{base.rstrip('/')}/uploads/{UPLOAD_SUBDIR}/{filename}"


def shop_logo_url(filename: str, base: str) -> str:
    return f"{base.rstrip('/')}/uploads/{SHOP_LOGO_SUBDIR}/{filename}"
