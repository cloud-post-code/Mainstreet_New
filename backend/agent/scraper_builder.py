"""
Scraper builder — AI agent loop that writes, tests, and validates a Python
web-scraping script for a given storefront URL.

Public surface:
  classify_seller_type(url, html)  -> "single" | "multi" | "unknown"
  build_scraper(url, html, seller_type, ...)  -> AsyncGenerator[dict, None]
  verify_sample(rows, url)  -> dict
"""
from __future__ import annotations

import json
import os
import random
import re
import subprocess
import tempfile
from decimal import Decimal, InvalidOperation
from typing import AsyncGenerator, Optional
from urllib.parse import urlparse

import anthropic
import httpx

from config import settings

MODEL = "claude-sonnet-4-6"

# ---------------------------------------------------------------------------
# Required and optional field sets
# ---------------------------------------------------------------------------

REQUIRED_FIELDS: list[str] = [
    "shop_name",
    "product_handle",
    "base_product_name",
    "product_name",
    "price",
    "quantity",
    "image_url",
    "description_json",
]

OPTIONAL_FIELDS: list[str] = [
    "variant_id",
    "variant_index",
    "option_names",
    "option_values",
    "parent_store",
]

FORBIDDEN_PATTERNS: list[str] = [
    "import subprocess",
    "import os",
    "os.system",
    "os.popen",
    "eval(",
    "exec(",
    "__import__",
]

# ---------------------------------------------------------------------------
# System prompt template
# ---------------------------------------------------------------------------

_SYSTEM_TMPL = """\
You are an expert at extracting product data from e-commerce websites. Your job is to write a
single self-contained Python script that retrieves ALL products from the site and prints a JSON
array to stdout.

SELLER TYPE: {seller_type}
  - "single": one brand sells everything. Use that brand/shop name for every product's shop_name.
  - "multi": marketplace with multiple sellers. Extract the per-product seller name for shop_name.
  - "unknown": treat as single seller; do your best.

═══════════════════════════════════════════════════════════════
STEP 1 — DETECT THE PLATFORM AND USE ITS API IF POSSIBLE
═══════════════════════════════════════════════════════════════

Before writing any HTML scraping code, check the URL and page HTML for platform signals.
If you can identify the platform, USE ITS NATIVE API — it is always more reliable, more
complete, and faster than HTML scraping.

SHOPIFY (most common)
  Signal: URL contains myshopify.com, OR meta generator tag says "Shopify", OR page HTML
          contains window.Shopify or /cdn/shop/
  API:    GET {base_url}/products.json?limit=250&page=N
          Paginate: keep incrementing ?page= until you get an empty products array.
          Each product has variants[]. Map like this:
            shop_name         = product.vendor  (or the store name from the page title)
            product_handle    = product.handle
            base_product_name = product.title
            product_name      = variant.title (use product.title if "Default Title")
            price             = variant.price  (already a string like "29.99")
            quantity          = str(variant.inventory_quantity) if available, else "1"
            image_url         = variant.featured_image.src OR product.images[0].src
            description_json  = JSON.dumps({{"summary": strip_html(product.body_html)[:200], "details": []}})
            variant_id        = str(variant.id)
            variant_index     = str(variant.position)
            option_names      = " / ".join(product.options[].name)
            option_values     = " / ".join(variant.option1, variant.option2, variant.option3 — skip None)

WIX
  Signal: URL contains wix.com or wixsite.com, OR HTML contains "wix-" class prefixes,
          OR window.__wix__ in the HTML
  API:    GET https://www.wixapis.com/stores/v1/products/query  (POST with empty body returns all)
          OR try the public storefront: {base_url}/_api/wix-ecommerce-storefront-web/api
          If no public API is accessible, fall back to HTML scraping.

SQUARE / SQUARESPACE
  Signal: URL contains squarespace.com, OR HTML contains "squarespace" assets
  API:    GET {base_url}/api/open/GetItemsByCategory  (Squarespace)
          OR {base_url}/api/products  — try this first, fall back to HTML if 404.

BIG CARTEL
  Signal: URL ends in bigcartel.com, OR HTML contains "Big Cartel"
  API:    GET https://api.bigcartel.com/{{account_slug}}/products.json
          Extract account_slug from the URL or page source.

BIGCOMMERCE
  Signal: HTML contains bigcommerce or cdn11.bigcommerce.com
  API:    GET {base_url}/api/storefront/catalog/products?limit=200&include=variants,images

ECWID
  Signal: HTML contains "ecwid" or "Ecwid.init"
  API:    Extract store ID from HTML (window.ec.storefront.storeId or similar)
          GET https://app.ecwid.com/api/v3/{{store_id}}/products?limit=100&offset=0

ETSY (multi-seller)
  Signal: URL is etsy.com
  Note:   Etsy's public API requires a key. Instead, scrape the HTML search/shop pages.
          Set seller_type="multi" and extract shop_name per listing.

GENERIC / UNKNOWN PLATFORM
  If no platform is detected, fall back to HTML scraping with httpx + BeautifulSoup.
  Look for common patterns: JSON-LD product schema, Open Graph tags, or data attributes.

═══════════════════════════════════════════════════════════════
STEP 2 — OUTPUT CONTRACT
═══════════════════════════════════════════════════════════════

Print ONLY a valid JSON array to stdout. No other text. No logging. No markdown.
Each element is one product VARIANT. Single-variant products get exactly one element with variant_index="1".

REQUIRED FIELDS — every element must have ALL of these (missing any = the script fails):
  shop_name         (string) — seller or brand name
  product_handle    (string) — URL-safe slug, lowercase, hyphens only, unique per parent product
                               Derive from product title. e.g. "blue-canvas-tote"
                               NOT "Blue Canvas Tote", NOT a numeric ID like "12345"
  base_product_name (string) — parent product title, IDENTICAL across all variants of one product
  product_name      (string) — variant display name; same as base_product_name if no variants
  price             (string) — decimal string e.g. "29.99"; use "0.00" only if truly free
  quantity          (string) — integer string e.g. "10"; use "1" if stock count is unavailable
  image_url         (string) — ABSOLUTE https:// URL to product image
  description_json  (string) — JSON-encoded: {{"summary": "one sentence", "details": ["bullet1"]}}
                               If no description: {{"summary": "No description available.", "details": []}}

OPTIONAL FIELDS — include when available:
  variant_id    (string) — platform's internal variant ID; use "" if unavailable
  variant_index (string) — "1", "2", "3" … ALWAYS include, "1" for single-variant products
  option_names  (string) — slash-joined option type labels e.g. "Color / Size"
  option_values (string) — slash-joined option values e.g. "Blue / Large"
  parent_store  (string) — marketplace/platform name if applicable e.g. "Etsy"

═══════════════════════════════════════════════════════════════
STEP 3 — RULES
═══════════════════════════════════════════════════════════════

1. Allowed imports: httpx, bs4 (BeautifulSoup), json, re, html, urllib.parse, time, math.
   These are all pre-installed. Do NOT pip install anything.
2. Do NOT use: subprocess, os.system, os.popen, eval(), exec(), __import__
3. Fully self-contained — no arguments, no user input, no environment variables, no API keys.
4. Paginate until you have ALL products. For APIs use page/offset params; for HTML follow
   next-page links. Hard cap: 50 pages / 5000 products, whichever comes first.
5. No duplicate product_handle values across parent products. Variants of the same product
   share a handle and are NOT duplicates.
6. If a required field is genuinely unavailable for a product, skip that product entirely.
   Do not emit a row with empty required fields.
7. Print ONLY the JSON array to stdout. Errors and debug info go to stderr.
8. Strip HTML tags from any description before putting it in description_json.
9. If using a paginated API, add a small sleep (0.2s) between pages to be polite.

═══════════════════════════════════════════════════════════════
CURRENT PAGE URL: {url}

PAGE HTML (first 50000 chars — use this to detect the platform):
{html_excerpt}

{retry_context}"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _extract_python(text: str) -> str:
    """Pull the first ```python ... ``` block from text, or return the whole text."""
    match = re.search(r"```python\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # Try plain ``` block
    match = re.search(r"```\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def _is_valid_handle(value: str) -> bool:
    """product_handle must be lowercase, hyphens/digits/letters only, no spaces."""
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9\-]*", value))


def _is_absolute_image_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Public: classify_seller_type
# ---------------------------------------------------------------------------


async def classify_seller_type(url: str, html: str) -> str:
    """Ask Claude whether this storefront has a single seller or multiple.

    Returns one of: "single", "multi", "unknown".
    """
    client = _make_client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=16,
        system=(
            "You classify websites. Reply with exactly one word: 'single', 'multi', or 'unknown'. "
            "single=one seller/brand throughout. "
            "multi=marketplace with multiple sellers per page (e.g. Etsy, Amazon, eBay). "
            "unknown=cannot determine."
        ),
        messages=[
            {
                "role": "user",
                "content": f"URL: {url}\n\nPage title and first 3000 chars of HTML:\n{html[:3000]}",
            }
        ],
    )
    raw = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            raw = block.text.strip().lower()
            break
    first_word = raw.split()[0] if raw.split() else "unknown"
    if first_word in ("single", "multi", "unknown"):
        return first_word
    return "unknown"


# ---------------------------------------------------------------------------
# Security: forbidden import check
# ---------------------------------------------------------------------------


def _check_forbidden(script_code: str) -> list[str]:
    """Return a list of forbidden patterns found in the script text."""
    found: list[str] = []
    for pattern in FORBIDDEN_PATTERNS:
        if pattern in script_code:
            found.append(pattern)
    return found


# ---------------------------------------------------------------------------
# Script runner
# ---------------------------------------------------------------------------


def _run_script(script_code: str) -> tuple[str, str]:
    """Write *script_code* to a temp file, run it with python3, return (stdout, stderr).

    Deletes the temp file whether or not execution succeeds.
    The subprocess is limited to 30 seconds.
    """
    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".py",
            delete=False,
            encoding="utf-8",
        ) as f:
            f.write(script_code)
            tmp_path = f.name

        result = subprocess.run(
            ["python3", tmp_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return "", "Script timed out after 30 seconds"
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def execute_script(script_code: str, url: str) -> list[dict]:
    """Public entry-point for re-running a saved scraper script.

    Runs the script in a subprocess, validates the output against the full
    required-field contract, and returns the parsed rows.
    Raises ValueError with a human-readable message on failure.
    """
    forbidden = _check_forbidden(script_code)
    if forbidden:
        raise ValueError(f"Script contains forbidden patterns: {', '.join(forbidden)}")

    stdout, stderr = _run_script(script_code)
    if not stdout.strip():
        raise ValueError(f"Script produced no output. stderr: {stderr[:500]}")

    try:
        rows: list[dict] = json.loads(stdout)
    except json.JSONDecodeError as e:
        raise ValueError(f"Script output is not valid JSON: {e}. stdout[:200]: {stdout[:200]}") from e

    errors = _validate_output(rows)
    if errors:
        raise ValueError("Scraper output failed validation:\n" + "\n".join(errors))

    return rows


# ---------------------------------------------------------------------------
# Output validator
# ---------------------------------------------------------------------------


def _validate_output(rows: list[dict]) -> list[str]:
    """Validate a list of scraped product dicts.

    Returns a list of human-readable error strings.  An empty list means the
    output is valid and ready for ingestion.
    """
    errors: list[str] = []

    if not rows:
        return ["No products scraped"]

    for i, row in enumerate(rows):
        prefix = f"Row {i + 1}"

        # --- shop_name ---
        shop_name = row.get("shop_name", "")
        if not isinstance(shop_name, str) or not shop_name.strip():
            errors.append(f"{prefix}: shop_name is empty or missing")

        # --- product_handle ---
        handle = row.get("product_handle", "")
        if not isinstance(handle, str) or not handle.strip():
            errors.append(f"{prefix}: product_handle is empty or missing")
        elif not _is_valid_handle(handle):
            errors.append(
                f"{prefix}: product_handle {handle!r} is not URL-safe "
                "(must be lowercase, letters/digits/hyphens only)"
            )

        # --- base_product_name ---
        base_name = row.get("base_product_name", "")
        if not isinstance(base_name, str) or not base_name.strip():
            errors.append(f"{prefix}: base_product_name is empty or missing")

        # --- product_name ---
        product_name = row.get("product_name", "")
        if not isinstance(product_name, str) or not product_name.strip():
            errors.append(f"{prefix}: product_name is empty or missing")

        # --- price ---
        price_raw = row.get("price", "")
        try:
            price_val = Decimal(str(price_raw).strip())
            if price_val < 0:
                errors.append(f"{prefix}: price must be >= 0, got {price_raw!r}")
        except (InvalidOperation, TypeError):
            errors.append(f"{prefix}: price {price_raw!r} is not a valid decimal")

        # --- quantity ---
        qty_raw = row.get("quantity", "")
        try:
            qty_val = int(str(qty_raw).strip())
            if qty_val < 0:
                errors.append(f"{prefix}: quantity must be >= 0, got {qty_raw!r}")
        except (ValueError, TypeError):
            errors.append(f"{prefix}: quantity {qty_raw!r} is not a valid integer")

        # --- image_url ---
        image_url = row.get("image_url", "")
        if not isinstance(image_url, str) or not _is_absolute_image_url(image_url):
            errors.append(
                f"{prefix}: image_url {image_url!r} is not an absolute http(s) URL"
            )

        # --- description_json ---
        desc_raw = row.get("description_json", "")
        if not isinstance(desc_raw, str) or not desc_raw.strip():
            errors.append(f"{prefix}: description_json is empty or missing")
        else:
            # Accept either valid JSON or a non-empty plain string
            stripped = desc_raw.strip()
            if stripped.startswith("{") or stripped.startswith("["):
                try:
                    json.loads(stripped)
                except json.JSONDecodeError:
                    errors.append(
                        f"{prefix}: description_json looks like JSON but is invalid"
                    )

    return errors


# ---------------------------------------------------------------------------
# Sample verifier
# ---------------------------------------------------------------------------


async def verify_sample(rows: list[dict], url: str) -> dict:
    """Spot-check up to 3 random rows by fetching each product's image_url.

    For each sampled row we issue a HEAD request to the image_url and verify:
      - HTTP 200 response
      - Content-Type starts with "image/"

    Returns::

        {
            "passed": bool,
            "sample_results": [{"image_url": str, "ok": bool, "reason": str}, ...],
            "mismatch_reason": str | None,
        }
    """
    sample_size = min(3, len(rows))
    sampled = random.sample(rows, sample_size) if sample_size else []

    sample_results: list[dict] = []
    failures: list[str] = []

    timeout = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for row in sampled:
            image_url = row.get("image_url", "")
            entry: dict = {"image_url": image_url, "ok": False, "reason": ""}
            try:
                resp = await client.head(image_url)
                if resp.status_code != 200:
                    entry["reason"] = f"HTTP {resp.status_code}"
                    failures.append(f"{image_url}: HTTP {resp.status_code}")
                else:
                    ct = resp.headers.get("content-type", "")
                    if not ct.lower().startswith("image/"):
                        entry["reason"] = f"unexpected content-type: {ct}"
                        failures.append(f"{image_url}: content-type={ct!r}")
                    else:
                        entry["ok"] = True
                        entry["reason"] = "ok"
            except Exception as exc:
                entry["reason"] = str(exc)
                failures.append(f"{image_url}: {exc}")
            sample_results.append(entry)

    passed = len(failures) == 0
    mismatch_reason: Optional[str] = "; ".join(failures) if failures else None
    return {
        "passed": passed,
        "sample_results": sample_results,
        "mismatch_reason": mismatch_reason,
    }


# ---------------------------------------------------------------------------
# Main builder loop
# ---------------------------------------------------------------------------


async def build_scraper(
    url: str,
    html: str,
    seller_type: str,
    shop_name_override: Optional[str] = None,
    max_attempts: int = 5,
) -> AsyncGenerator[dict, None]:
    """Async generator that builds, runs, and validates a scraping script.

    Yields SSE-style event dicts:

    * ``{"type": "stage", "stage": "building", "attempt": n, "max": max_attempts}``
    * ``{"type": "attempt_result", "attempt": n, "errors": [...]}``  — on failure
    * ``{"type": "sample_check", "result": {...}}``  — after validation passes
    * ``{"type": "script_ready", "script_code": str, "rows": [...]}``  — success
    * ``{"type": "cannot_scrape", "message": str, "detail": str}``  — all attempts failed
    """
    client = _make_client()
    html_excerpt = html[:50000]

    prev_stdout: str = ""
    prev_errors: list[str] = []
    last_three_error_sigs: list[str] = []
    last_error_detail: str = "No attempts completed."

    for attempt in range(1, max_attempts + 1):
        yield {"type": "stage", "stage": "building", "attempt": attempt, "max": max_attempts}

        # Build retry context for attempts after the first.
        if attempt == 1:
            retry_context = ""
        else:
            errors_joined = "\n".join(f"- {e}" for e in prev_errors)
            retry_context = (
                f"PREVIOUS ATTEMPT FAILED\n"
                f"-----------------------\n"
                f"Attempt {attempt - 1} produced output:\n"
                f"{prev_stdout[:2000]}\n\n"
                f"Validation errors:\n"
                f"{errors_joined}\n\n"
                f"Fix these specific problems."
            )

        system_prompt = _SYSTEM_TMPL.format(
            seller_type=seller_type,
            url=url,
            html_excerpt=html_excerpt,
            retry_context=retry_context,
        )

        # Call Claude with streaming so the frontend can show live progress.
        full_text = ""
        char_count = 0
        with client.messages.stream(
            model=MODEL,
            max_tokens=8192,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "First, identify the platform from the URL and HTML (Shopify, Wix, Squarespace, "
                        "BigCartel, BigCommerce, Ecwid, or unknown). If a native API is available, use it — "
                        "do not scrape HTML when an API exists. "
                        "Then write the complete Python script. "
                        "Output ONLY the script — no explanation, no markdown, no preamble."
                    ),
                }
            ],
        ) as stream:
            for chunk in stream.text_stream:
                full_text += chunk
                char_count += len(chunk)
                # Emit a thinking chunk every ~200 chars so the UI feels live
                # without flooding the SSE channel.
                if char_count >= 200:
                    yield {
                        "type": "thinking",
                        "attempt": attempt,
                        "chars_written": len(full_text),
                        "preview": full_text[-120:],
                    }
                    char_count = 0
        # Final thinking event with total char count
        yield {
            "type": "thinking",
            "attempt": attempt,
            "chars_written": len(full_text),
            "preview": full_text[-120:],
            "done": True,
        }

        script_code = _extract_python(full_text)

        # Security gate: reject forbidden patterns before execution.
        forbidden = _check_forbidden(script_code)
        if forbidden:
            errors = [f"Forbidden pattern in script: {p!r}" for p in forbidden]
            prev_errors = errors
            prev_stdout = ""
            last_error_detail = "; ".join(errors)
            yield {"type": "attempt_result", "attempt": attempt, "errors": errors}

            # Loop-detection check.
            sig = "\n".join(sorted(errors))
            last_three_error_sigs.append(sig)
            if len(last_three_error_sigs) > 3:
                last_three_error_sigs.pop(0)
            if len(last_three_error_sigs) == 3 and len(set(last_three_error_sigs)) == 1:
                break
            continue

        # Run the script.
        yield {"type": "running_script", "attempt": attempt, "message": "Running script in sandbox..."}
        stdout, stderr = _run_script(script_code)
        prev_stdout = stdout

        # Parse stdout as JSON.
        rows: list[dict] = []
        parse_errors: list[str] = []
        stripped_out = stdout.strip()
        if not stripped_out:
            parse_errors.append(
                f"Script produced no stdout. stderr: {stderr[:500]}" if stderr else "Script produced no stdout."
            )
        else:
            try:
                parsed = json.loads(stripped_out)
                if not isinstance(parsed, list):
                    parse_errors.append(
                        f"Script output is not a JSON array (got {type(parsed).__name__})"
                    )
                else:
                    rows = parsed
                    # Emit live count so UI can show progress immediately
                    unique_products = len({r.get("product_handle") for r in rows if r.get("product_handle")})
                    unique_shops = len({r.get("shop_name") for r in rows if r.get("shop_name")})
                    yield {
                        "type": "rows_scraped",
                        "attempt": attempt,
                        "rows": len(rows),
                        "products": unique_products,
                        "shops": unique_shops,
                    }
            except json.JSONDecodeError as exc:
                parse_errors.append(f"Script output is not valid JSON: {exc}")

        # Validate schema.
        if not parse_errors:
            validation_errors = _validate_output(rows)
        else:
            validation_errors = parse_errors

        errors = validation_errors
        last_error_detail = "; ".join(errors) if errors else ""

        if errors:
            prev_errors = errors
            yield {"type": "attempt_result", "attempt": attempt, "errors": errors}

            # Loop-detection: break early if the last 3 error sets are identical.
            sig = "\n".join(sorted(errors))
            last_three_error_sigs.append(sig)
            if len(last_three_error_sigs) > 3:
                last_three_error_sigs.pop(0)
            if len(last_three_error_sigs) == 3 and len(set(last_three_error_sigs)) == 1:
                break
            continue

        # --- Validation passed ---

        # Apply shop_name_override if provided.
        if shop_name_override and seller_type == "single":
            for row in rows:
                row["shop_name"] = shop_name_override

        # Spot-check a sample.
        sample_result = await verify_sample(rows, url)
        yield {"type": "sample_check", "result": sample_result}

        yield {"type": "script_ready", "script_code": script_code, "rows": rows}
        return

    # All attempts exhausted (or early break).
    yield {
        "type": "cannot_scrape",
        "message": (
            "I cannot build the correct scraping script to gather "
            "the necessary information from this site."
        ),
        "detail": last_error_detail,
    }
