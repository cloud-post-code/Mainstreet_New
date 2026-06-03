"""Shared safety helpers for HTTP uploads and outbound fetches.

- read_capped(file, max_bytes): stream UploadFile in chunks; abort over cap.
- validate_image_bytes(blob): magic-byte sniff; returns (media_type, extension)
  or raises HTTPException(400). Rejects SVG and anything that isn't a known
  raster image format.
- assert_public_http_url(url): rejects non-http(s), private/loopback/link-local
  IPs, and unresolved hostnames. Returns the parsed URL.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException, UploadFile


# ── Upload size cap ─────────────────────────────────────────────────────────

CHUNK = 64 * 1024


async def read_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read an UploadFile in chunks; abort with 413 if it exceeds max_bytes."""
    size = 0
    chunks: list[bytes] = []
    while True:
        chunk = await file.read(CHUNK)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(status_code=413, detail="File too large")
        chunks.append(chunk)
    return b"".join(chunks)


# ── Image magic-byte validation ─────────────────────────────────────────────

# (media_type, extension, predicate) — predicate inspects the first ~16 bytes.
_IMAGE_SIGNATURES: list[tuple[str, str, callable]] = [
    ("image/jpeg", ".jpg", lambda b: b[:3] == b"\xff\xd8\xff"),
    ("image/png", ".png", lambda b: b[:8] == b"\x89PNG\r\n\x1a\n"),
    ("image/gif", ".gif", lambda b: b[:6] in (b"GIF87a", b"GIF89a")),
    ("image/webp", ".webp", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
]


def validate_image_bytes(blob: bytes) -> tuple[str, str]:
    """Sniff magic bytes. Returns (media_type, extension) or raises 400.

    Explicitly rejects SVG (XSS vector when served from same origin) by virtue
    of not matching any allowed signature.
    """
    head = blob[:16]
    for media_type, ext, predicate in _IMAGE_SIGNATURES:
        if predicate(head):
            return media_type, ext
    raise HTTPException(
        status_code=400,
        detail="Unsupported image format. Allowed: jpeg, png, gif, webp.",
    )


# ── SSRF guard ──────────────────────────────────────────────────────────────


def assert_public_http_url(url: str) -> str:
    """Reject non-public URLs before we fetch them.

    Blocks:
    - Schemes other than http/https
    - Hostnames that resolve to private, loopback, link-local, multicast,
      reserved, or unspecified IP addresses (any address family).
    Returns the original URL on success; raises 400 otherwise.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="URL must use http or https")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="URL missing hostname")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="URL host could not be resolved")

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr.split("%", 1)[0])
        except ValueError:
            raise HTTPException(status_code=400, detail="URL host resolved to invalid address")
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="URL host is not publicly routable")

    return url
