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
You are a Python web scraping expert. Your job is to write a single self-contained
Python script that scrapes product data from the page provided and prints a JSON array to stdout.

SELLER TYPE: {seller_type}
  - "single": one brand sells everything on this page. Use the brand/shop name for every product's shop_name.
  - "multi": multiple sellers appear on this page (marketplace). Extract the per-product seller name for each product's shop_name.
  - "unknown": treat as single seller but do your best.

OUTPUT CONTRACT
---------------
Print ONLY a valid JSON array to stdout. No other text. No logging. No markdown.
Each element of the array is one product VARIANT (a specific color/size/style).
If a product has no variants, emit exactly one element with variant_index = 1.

REQUIRED FIELDS (every element must have ALL of these — missing any = the script fails):
  shop_name         (string) — seller or brand name
  product_handle    (string) — URL-safe slug, lowercase, hyphens only, unique per parent product
                               e.g. "blue-canvas-tote" NOT "Blue Canvas Tote" NOT "blue canvas tote"
  base_product_name (string) — parent product title, IDENTICAL for all variants of one product
  product_name      (string) — variant display name; if no variants, same as base_product_name
  price             (string) — decimal price e.g. "29.99"; use "0.00" only if truly free
  quantity          (string) — stock count as integer string e.g. "10"; use "1" if stock is not shown
  image_url         (string) — ABSOLUTE https:// URL to the primary product image
  description_json  (string) — JSON string: {{"summary": "one sentence", "details": ["bullet1", "bullet2"]}}
                               If no description: {{"summary": "No description available.", "details": []}}

OPTIONAL FIELDS (include if present on the page):
  variant_id    (string) — the site's internal variant ID; use "" if not available
  variant_index (string) — "1", "2", "3" etc; ALWAYS include, use "1" for single-variant products
  option_names  (string) — slash-joined option type labels e.g. "Color / Size"
  option_values (string) — slash-joined option values matching option_names e.g. "Blue / Large"
  parent_store  (string) — marketplace name if applicable e.g. "Etsy"

RULES
-----
1. Use ONLY httpx and beautifulsoup4 (bs4). Both are pre-installed. Do NOT import anything else that requires installation.
2. Do NOT use: subprocess, os.system, os.popen, eval(), exec(), __import__
3. The script must be fully self-contained — no arguments, no user input, no environment variables.
4. Handle pagination: follow next-page links up to 10 pages. Stop at 10 even if more exist.
5. Do NOT emit duplicate product_handle values (same handle = same parent product). Variants are NOT duplicates.
6. If you cannot extract a required field for a product, SKIP that product — do not emit a row with empty required fields.
7. Print ONLY the JSON array to stdout. All logging/warnings go to stderr.
8. product_handle must be derived from the product name, NOT from a numeric ID.

CURRENT PAGE URL: {url}

PAGE HTML (first 50000 chars):
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
                        "Write the complete Python scraping script now. "
                        "Output ONLY the script — no explanation, no markdown preamble."
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
