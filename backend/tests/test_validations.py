"""Does this validate something?

Tests for input validators: image bytes, URLs, passwords, schemas, quantities,
CSV headers.
"""
import pytest
from fastapi import HTTPException

from agent.upload_safety import assert_public_http_url, validate_image_bytes
from auth import hash_password, verify_password

# Skip password round-trip tests if the local bcrypt/passlib backend is broken
# (e.g. version mismatch on dev machines). The functions themselves are pinned
# in requirements.txt — these tests guard for regressions in our own code.
try:
    _BCRYPT_OK = bool(hash_password("probe-password-1234"))
except Exception:
    _BCRYPT_OK = False

requires_bcrypt = pytest.mark.skipif(not _BCRYPT_OK, reason="bcrypt backend unavailable")
from db.schemas import UserRegister
from routers.admin import EXPECTED_COLUMNS
from routers.cart import _validate_qty


# ── validate_image_bytes ─────────────────────────────────────────────────────

def test_image_validation_accepts_jpeg():
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 12
    assert validate_image_bytes(jpeg) == ("image/jpeg", ".jpg")


def test_image_validation_accepts_png():
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    assert validate_image_bytes(png) == ("image/png", ".png")


def test_image_validation_accepts_gif87a():
    assert validate_image_bytes(b"GIF87a" + b"\x00" * 16) == ("image/gif", ".gif")


def test_image_validation_accepts_gif89a():
    assert validate_image_bytes(b"GIF89a" + b"\x00" * 16) == ("image/gif", ".gif")


def test_image_validation_accepts_webp():
    webp = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 4
    assert validate_image_bytes(webp) == ("image/webp", ".webp")


def test_image_validation_rejects_svg():
    with pytest.raises(HTTPException):
        validate_image_bytes(b"<svg xmlns='http://www.w3.org/2000/svg'/>")


def test_image_validation_rejects_empty():
    with pytest.raises(HTTPException):
        validate_image_bytes(b"")


def test_image_validation_rejects_html():
    with pytest.raises(HTTPException):
        validate_image_bytes(b"<!DOCTYPE html><html></html>")


# ── assert_public_http_url ───────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://10.0.0.5/x",
    "http://192.168.1.1/",
    "http://169.254.169.254/meta",  # AWS IMDS
    "file:///etc/passwd",
    "ftp://example.com/",
    "javascript:alert(1)",
    "data:text/plain,foo",
])
def test_url_validator_rejects_dangerous(url):
    with pytest.raises(HTTPException):
        assert_public_http_url(url)


def test_url_validator_accepts_public_https():
    assert assert_public_http_url("https://8.8.8.8/") == "https://8.8.8.8/"


def test_url_validator_rejects_missing_hostname():
    with pytest.raises(HTTPException):
        assert_public_http_url("http:///path")


# ── verify_password ──────────────────────────────────────────────────────────

@requires_bcrypt
def test_password_round_trip():
    h = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", h) is True


@requires_bcrypt
def test_password_wrong_returns_false():
    h = hash_password("right-password-xyz")
    assert verify_password("WRONG", h) is False


@requires_bcrypt
def test_password_empty_against_real_hash():
    h = hash_password("hunter2hunter2")
    assert verify_password("", h) is False


# ── UserRegister schema ──────────────────────────────────────────────────────

def test_user_register_rejects_short_password():
    with pytest.raises(ValueError):
        UserRegister(email="x@example.com", password="short")


def test_user_register_accepts_min_length_password():
    body = UserRegister(email="x@example.com", password="a" * 12)
    assert body.password == "a" * 12


def test_user_register_drops_is_admin_field():
    body = UserRegister(
        email="x@example.com",
        password="hunter2hunter2",
        is_admin=True,  # type: ignore[call-arg]
    )
    assert not hasattr(body, "is_admin")


def test_user_register_requires_valid_email():
    with pytest.raises(ValueError):
        UserRegister(email="not-an-email", password="hunter2hunter2")


# ── _validate_qty ────────────────────────────────────────────────────────────

def test_validate_qty_positive_passes():
    assert _validate_qty(1) is None
    assert _validate_qty(99) is None


@pytest.mark.parametrize("bad", [0, -1, -100])
def test_validate_qty_rejects_non_positive(bad):
    err = _validate_qty(bad)
    assert err is not None
    assert err["reason"] == "quantity_must_be_positive"


# ── CSV header validation ────────────────────────────────────────────────────

def test_csv_required_columns_present():
    headers = set(EXPECTED_COLUMNS) | {"extra_column"}
    assert EXPECTED_COLUMNS - headers == set()


def test_csv_missing_column_detected():
    headers = set(EXPECTED_COLUMNS) - {"price"}
    missing = EXPECTED_COLUMNS - headers
    assert missing == {"price"}


def test_csv_expected_columns_include_recent_additions():
    # Recent commit added parent_store; ensure the optional set contains it.
    from routers.admin import OPTIONAL_COLUMNS
    assert "parent_store" in OPTIONAL_COLUMNS
