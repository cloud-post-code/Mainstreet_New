#!/usr/bin/env python3
"""
Scrape Boston General Store collections — defaults to Shop All (~2,100+ products).

Output CSV columns: shop_name, product_name, product_url, price, quantity, image_url, description_json

shop_name comes from "Made by:" on the product page (falls back to vendor).
Each variant is its own row. quantity is always 1.
product_url is the public product page on bostongeneralstore.com, including ?variant= when applicable.

Usage:
  python3 scrape_boston_general_store_assorted_goods.py
  python3 scrape_boston_general_store_assorted_goods.py --no-review-html   # faster, fewer requests
  python3 scrape_boston_general_store_assorted_goods.py --no-crawl-html-pages
  python3 scrape_boston_general_store_assorted_goods.py --collection assorted-goods
"""

from __future__ import annotations

import argparse
import builtins
import functools
import sys
import csv
import json
import random
import re
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

SHOP_ALL_SLUG = "shop-all"
SHOP_ALL_URL = "https://www.bostongeneralstore.com/collections/shop-all"
COLLECTION_SLUG = SHOP_ALL_SLUG
COLLECTION_URL = SHOP_ALL_URL
OUTPUT_CSV = Path(__file__).resolve().parent / "boston_general_store_shop_all.csv"
MAX_COLLECTION_HTML_PAGES = 90
PRODUCT_DELAY_SEC = 1.5
COLLECTION_DELAY_SEC = 2.5
MIN_REQUEST_INTERVAL_SEC = 1.0
MAX_RETRIES = 8
BACKOFF_BASE_SEC = 10
BACKOFF_MAX_SEC = 180
CRAWL_HTML_PAGES = True  # merge HTML listing with products.json for full shop-all coverage
FETCH_REVIEW_HTML = True
SAVE_EVERY_N_PRODUCTS = 100
USER_AGENT = "Mozilla/5.0 (compatible; BostonGeneralStoreCatalog/1.0; +https://www.bostongeneralstore.com)"
PRODUCT_URL_BASE = "https://www.bostongeneralstore.com/products"

FIELDNAMES = [
    "shop_name",
    "product_name",
    "product_url",
    "price",
    "quantity",
    "image_url",
    "description_json",
]

_last_request_at = 0.0


def polite_pause(seconds: float) -> None:
    """Wait between requests with jitter so traffic is spread out."""
    global _last_request_at
    jitter = random.uniform(0.15, 0.55)
    target = max(seconds, MIN_REQUEST_INTERVAL_SEC) + jitter
    elapsed = time.monotonic() - _last_request_at
    wait = max(0.0, target - elapsed)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def backoff_seconds(err: Exception, attempt: int) -> float:
    if isinstance(err, urllib.error.HTTPError):
        if err.code == 429:
            retry_after = err.headers.get("Retry-After")
            if retry_after:
                try:
                    return min(BACKOFF_MAX_SEC, max(float(retry_after), BACKOFF_BASE_SEC))
                except ValueError:
                    pass
            return min(BACKOFF_MAX_SEC, BACKOFF_BASE_SEC * (2**attempt))
        if err.code in {500, 502, 503, 504}:
            return min(BACKOFF_MAX_SEC, BACKOFF_BASE_SEC * (attempt + 1))
    return min(BACKOFF_MAX_SEC, BACKOFF_BASE_SEC * (attempt + 1))


def fetch(url: str, retries: int = MAX_RETRIES, pause_before: float = MIN_REQUEST_INTERVAL_SEC) -> str:
    last_err: Exception | None = None
    for attempt in range(retries):
        polite_pause(pause_before)
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,text/html,*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            last_err = err
            if err.code in {400, 401, 403, 404, 410}:
                raise
            if err.code == 429:
                wait = backoff_seconds(err, attempt)
                print(f"  rate limited (429), waiting {wait:.0f}s before retry…")
                time.sleep(wait)
            elif err.code in {500, 502, 503, 504} and attempt < retries - 1:
                wait = backoff_seconds(err, attempt)
                print(f"  server error ({err.code}), waiting {wait:.0f}s before retry…")
                time.sleep(wait)
            elif attempt < retries - 1:
                time.sleep(backoff_seconds(err, attempt))
            else:
                raise
        except Exception as err:
            last_err = err
            if attempt < retries - 1:
                time.sleep(backoff_seconds(err, attempt))
            else:
                raise
    raise last_err  # type: ignore[misc]


def fetch_json(url: str, pause_before: float = MIN_REQUEST_INTERVAL_SEC) -> dict:
    return json.loads(fetch(url, pause_before=pause_before))


def strip_tags(html_fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html_fragment, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def extract_labeled_fields(body_html: str) -> dict[str, str]:
    """Parse <em><strong>Label:</strong></em> value blocks from Shopify body_html."""
    fields: dict[str, str] = {}
    pattern = re.compile(
        r"<em>\s*<strong>\s*([^<:]+?)\s*:?\s*</strong>\s*</em>\s*(.*?)(?=</p>)",
        re.I | re.S,
    )
    for match in pattern.finditer(body_html):
        label = strip_tags(match.group(1)).rstrip(":").strip()
        value = strip_tags(match.group(2))
        if label and value:
            key = re.sub(r"\s+", "_", label.lower())
            fields[key] = value
    return fields


def main_description(body_html: str) -> str:
    """Description text before labeled metadata blocks (Made by, Made in, etc.)."""
    cut = re.search(
        r"<em>\s*<strong>\s*(?:Made by|Made in|Further Reading|Reviews|Care)\s*:",
        body_html,
        re.I,
    )
    chunk = body_html[: cut.start()] if cut else body_html
    return strip_tags(chunk)


def parse_reviews_from_html(html: str) -> str:
    patterns = [
        r'"reviewCount"\s*:\s*"?(\d+)"?',
        r"(\d+)\s+reviews?\b",
        r"(\d+)\s+review\b",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.I)
        if m:
            n = m.group(1)
            return f"{n} review" if n == "1" else f"{n} reviews"
    return ""


def normalize_handle(handle: str) -> str | None:
    if re.search(r"-boston-general-store-\d+$", handle):
        return None
    return handle


def collect_handles_from_json() -> list[str]:
    handles: list[str] = []
    seen: set[str] = set()
    page = 1
    while True:
        url = f"{COLLECTION_URL}/products.json?limit=250&page={page}"
        try:
            data = fetch_json(url)
        except urllib.error.HTTPError:
            break
        products = data.get("products") or []
        if not products:
            break
        for product in products:
            h = product["handle"]
            if h not in seen:
                seen.add(h)
                handles.append(h)
        print(f"products.json page {page}: +{len(products)} (unique {len(handles)})")
        page += 1
        polite_pause(COLLECTION_DELAY_SEC)
    return handles


def collect_handles_from_html() -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for page in range(1, MAX_COLLECTION_HTML_PAGES + 1):
        url = f"{COLLECTION_URL}?page={page}"
        try:
            html = fetch(url)
        except urllib.error.HTTPError as err:
            print(f"collection HTML page {page}: HTTP {err.code}, stopping")
            break
        raw = set(re.findall(r"/products/([a-z0-9][a-z0-9-]*)", html))
        new_count = 0
        for raw_handle in raw:
            handle = normalize_handle(raw_handle)
            if not handle or handle in seen:
                continue
            seen.add(handle)
            ordered.append(handle)
            new_count += 1
        print(f"collection HTML page {page}: {len(raw)} links, +{new_count} new (unique {len(ordered)})")
        if page >= 2 and new_count == 0:
            break
        polite_pause(COLLECTION_DELAY_SEC)
    return ordered


def variant_image(variant: dict, product: dict) -> str:
    featured = variant.get("featured_image") or {}
    src = featured.get("src")
    if src:
        return src
    if product.get("images"):
        return product["images"][0].get("src", "")
    return ""


def build_product_name(title: str, variant_title: str) -> str:
    if variant_title and variant_title != "Default Title":
        return f"{title} - {variant_title}"
    return title


def product_page_url(handle: str, variant_id: int | None = None) -> str:
    url = f"{PRODUCT_URL_BASE}/{handle}"
    if variant_id:
        url = f"{url}?variant={variant_id}"
    return url


def handle_from_product_url(url: str) -> str | None:
    match = re.search(r"/products/([a-z0-9][a-z0-9-]*)", url or "")
    if not match:
        return None
    return normalize_handle(match.group(1))


def fetch_collection_product_count() -> int | None:
    url = f"{COLLECTION_URL}.json"
    try:
        data = fetch_json(url, pause_before=0)
    except urllib.error.HTTPError:
        return None
    count = (data.get("collection") or {}).get("products_count")
    return int(count) if count is not None else None


def merge_handles(*sources: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for source in sources:
        for handle in source:
            if handle not in seen:
                seen.add(handle)
                merged.append(handle)
    return merged


def scrape_product(handle: str) -> list[dict]:
    api_url = f"https://www.bostongeneralstore.com/products/{handle}.json"
    try:
        data = fetch_json(api_url, pause_before=PRODUCT_DELAY_SEC)
    except urllib.error.HTTPError:
        return []

    product = data["product"]
    body_html = product.get("body_html") or ""
    labeled = extract_labeled_fields(body_html)
    shop_name = labeled.get("made_by") or product.get("vendor") or ""

    desc_text = main_description(body_html)
    made_in = labeled.get("made_in", "")
    further_reading = labeled.get("further_reading", "")
    care = labeled.get("care", "")

    reviews = labeled.get("reviews", "")
    if not reviews and FETCH_REVIEW_HTML:
        try:
            page_html = fetch(
                f"https://www.bostongeneralstore.com/products/{handle}",
                pause_before=PRODUCT_DELAY_SEC,
            )
            reviews = parse_reviews_from_html(page_html)
        except urllib.error.HTTPError:
            pass

    variants = product.get("variants") or []
    if not variants:
        return []

    rows: list[dict] = []
    for variant in variants:
        variant_title = variant.get("title") or ""
        description_json: dict[str, str] = {}
        if desc_text:
            description_json["description"] = desc_text
        if variant_title and variant_title != "Default Title":
            description_json["variant"] = variant_title
        if made_in:
            description_json["made_in"] = made_in
        if further_reading:
            description_json["further_reading"] = further_reading
        if reviews:
            description_json["reviews"] = reviews
        if care:
            description_json["care"] = care

        for key, value in labeled.items():
            if key in {"made_by", "made_in", "further_reading", "reviews", "care"}:
                continue
            if value and key not in description_json:
                description_json[key] = value

        price_raw = variant.get("price") or "0"
        try:
            price = f"{float(price_raw):.2f}"
        except ValueError:
            price = price_raw

        variant_id = variant.get("id")
        rows.append(
            {
                "shop_name": shop_name,
                "product_name": build_product_name(product["title"], variant_title),
                "product_url": product_page_url(handle, variant_id),
                "price": price,
                "quantity": "1",
                "image_url": variant_image(variant, product),
                "description_json": json.dumps(description_json, ensure_ascii=False),
            }
        )
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Boston General Store collection")
    parser.add_argument(
        "--collection",
        default=SHOP_ALL_SLUG,
        help=f"Collection slug (default: {SHOP_ALL_SLUG}). Example: assorted-goods",
    )
    parser.add_argument(
        "--shop-all",
        action="store_true",
        help=f"Scrape {SHOP_ALL_URL} (same as --collection {SHOP_ALL_SLUG})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output CSV path (default: scripts/boston_general_store_<collection>.csv)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=90,
        help="Max collection HTML pages to crawl when --crawl-html-pages is set (default: 90)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=PRODUCT_DELAY_SEC,
        help=f"Seconds between product requests (default: {PRODUCT_DELAY_SEC})",
    )
    parser.add_argument(
        "--collection-delay",
        type=float,
        default=COLLECTION_DELAY_SEC,
        help=f"Seconds between collection listing requests (default: {COLLECTION_DELAY_SEC})",
    )
    parser.add_argument(
        "--crawl-html-pages",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Merge handles from collection HTML pages (default: on for shop-all, off for other collections)",
    )
    parser.add_argument(
        "--no-review-html",
        action="store_true",
        help="Skip extra HTML fetch per product for review counts (fewer requests)",
    )
    parser.add_argument(
        "--save-every",
        type=int,
        default=SAVE_EVERY_N_PRODUCTS,
        help=f"Write CSV checkpoint every N products (default: {SAVE_EVERY_N_PRODUCTS})",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from last checkpoint (skips handles already saved)",
    )
    return parser.parse_args()


def configure_collection(
    slug: str,
    output: Path | None,
    max_pages: int,
    product_delay: float,
    collection_delay: float,
    crawl_html_pages: bool | None,
    fetch_review_html: bool,
) -> None:
    global COLLECTION_SLUG, COLLECTION_URL, OUTPUT_CSV, MAX_COLLECTION_HTML_PAGES
    global PRODUCT_DELAY_SEC, COLLECTION_DELAY_SEC, CRAWL_HTML_PAGES, FETCH_REVIEW_HTML
    COLLECTION_SLUG = slug.strip("/")
    COLLECTION_URL = f"https://www.bostongeneralstore.com/collections/{COLLECTION_SLUG}"
    if output:
        OUTPUT_CSV = output
    elif COLLECTION_SLUG == SHOP_ALL_SLUG:
        OUTPUT_CSV = Path(__file__).resolve().parent / "boston_general_store_shop_all.csv"
    else:
        OUTPUT_CSV = (
            Path(__file__).resolve().parent / f"boston_general_store_{COLLECTION_SLUG.replace('/', '_')}.csv"
        )
    MAX_COLLECTION_HTML_PAGES = max_pages
    PRODUCT_DELAY_SEC = max(0.5, product_delay)
    COLLECTION_DELAY_SEC = max(1.0, collection_delay)
    if crawl_html_pages is None:
        CRAWL_HTML_PAGES = COLLECTION_SLUG == SHOP_ALL_SLUG
    else:
        CRAWL_HTML_PAGES = crawl_html_pages
    FETCH_REVIEW_HTML = fetch_review_html


def progress_path() -> Path:
    return OUTPUT_CSV.with_suffix(".progress.json")


def save_csv(rows: list[dict], *, final: bool = False) -> None:
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    label = "Final save" if final else "Checkpoint"
    print(f"  {label}: {len(rows)} rows → {OUTPUT_CSV}")


def save_progress(done_handles: list[str], failed_handles: list[str], row_count: int) -> None:
    progress_path().write_text(
        json.dumps(
            {
                "collection": COLLECTION_SLUG,
                "done_handles": done_handles,
                "failed_handles": failed_handles,
                "row_count": row_count,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def load_existing_rows() -> list[dict]:
    if not OUTPUT_CSV.exists():
        return []
    with OUTPUT_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        row.setdefault("product_url", "")
    return rows


def done_handles_from_rows(rows: list[dict]) -> set[str]:
    done: set[str] = set()
    for row in rows:
        url = (row.get("product_url") or "").strip()
        if not url:
            continue
        handle = handle_from_product_url(url)
        if handle:
            done.add(handle)
    return done


def load_progress() -> tuple[set[str], list[str]]:
    path = progress_path()
    if not path.exists():
        return set(), []
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("collection") != COLLECTION_SLUG:
        print("Progress file is for a different collection; starting fresh.")
        return set(), []
    done = set(data.get("done_handles") or [])
    failed = list(data.get("failed_handles") or [])
    print(f"Resuming: {len(done)} products already done, {len(failed)} previously failed")
    return done, failed


def main() -> None:
    builtins.print = functools.partial(builtins.print, flush=True)  # type: ignore[method-assign]
    args = parse_args()
    collection_slug = SHOP_ALL_SLUG if args.shop_all else args.collection
    configure_collection(
        collection_slug,
        args.output,
        args.max_pages,
        args.delay,
        args.collection_delay,
        args.crawl_html_pages,
        not args.no_review_html,
    )
    print(f"Collection: {COLLECTION_URL}")
    print(f"Output: {OUTPUT_CSV}")
    print(
        f"Polite mode: {PRODUCT_DELAY_SEC:.1f}s between products, "
        f"{COLLECTION_DELAY_SEC:.1f}s between collection pages, "
        f"HTML page crawl={'on' if CRAWL_HTML_PAGES else 'off'}, "
        f"review HTML={'on' if FETCH_REVIEW_HTML else 'off'}"
    )

    expected_count = fetch_collection_product_count()
    if expected_count is not None:
        print(f"Collection reports ~{expected_count} products (Shopify may count variants separately).")

    print("Collecting product handles from products.json…")
    handles_json = collect_handles_from_json()
    handles_html: list[str] = []
    if CRAWL_HTML_PAGES:
        print("Also collecting handles from collection HTML pages…")
        handles_html = collect_handles_from_html()
    else:
        print("Skipping HTML page crawl (use --crawl-html-pages to enable).")

    handles = merge_handles(handles_json, handles_html)
    html_only = len(set(handles_html) - set(handles_json))
    if handles_html:
        print(
            f"Merged {len(handles_json)} JSON + {len(handles_html)} HTML handles "
            f"→ {len(handles)} unique ({html_only} only on HTML listing)."
        )
    else:
        print(f"Found {len(handles)} unique product handles.")

    save_every = max(1, args.save_every)
    done_handles: set[str] = set()
    all_rows: list[dict] = []
    failed: list[str] = []
    if args.resume:
        done_handles, failed = load_progress()
        all_rows = load_existing_rows()
        if not done_handles and all_rows:
            done_handles = done_handles_from_rows(all_rows)
            if done_handles:
                print(f"Inferred {len(done_handles)} completed products from existing product_url values.")
        rows_without_url = sum(1 for row in all_rows if not (row.get("product_url") or "").strip())
        if rows_without_url:
            print(
                f"Dropping {rows_without_url} legacy row(s) missing product_url; "
                "those products will be scraped again."
            )
            all_rows = [row for row in all_rows if (row.get("product_url") or "").strip()]
            done_handles = done_handles_from_rows(all_rows)
        if done_handles:
            print(f"Loaded {len(all_rows)} existing rows from {OUTPUT_CSV}")

    remaining = [h for h in handles if h not in done_handles]
    est_min = len(remaining) * (PRODUCT_DELAY_SEC + (PRODUCT_DELAY_SEC if FETCH_REVIEW_HTML else 0)) / 60
    print(
        f"\nScraping {len(remaining)} products "
        f"({len(done_handles)} skipped), checkpoint every {save_every} products, "
        f"~{est_min:.0f} min at current delay…"
    )

    done_list: list[str] = list(done_handles)
    products_since_save = 0

    for i, handle in enumerate(remaining, 1):
        rows = scrape_product(handle)
        if not rows:
            failed.append(handle)
        else:
            all_rows.extend(rows)
            done_list.append(handle)
        products_since_save += 1
        print(
            f"  [{len(done_list)}/{len(handles)}] {handle}: "
            f"{len(rows)} variant row(s), {len(all_rows)} rows total"
        )

        if products_since_save >= save_every:
            save_csv(all_rows)
            save_progress(done_list, failed, len(all_rows))
            products_since_save = 0
            polite_pause(COLLECTION_DELAY_SEC)

    if failed:
        print(f"\nRetrying {len(failed)} products that returned no rows (extra polite)…")
        polite_pause(COLLECTION_DELAY_SEC * 2)
        retry_failed: list[str] = []
        for i, handle in enumerate(failed, 1):
            rows = scrape_product(handle)
            if rows:
                all_rows.extend(rows)
                done_list.append(handle)
            else:
                retry_failed.append(handle)
            print(f"  [retry {i}/{len(failed)}] {handle}: {len(rows)} variant row(s)")
            polite_pause(PRODUCT_DELAY_SEC * 2)
        failed = retry_failed

    save_csv(all_rows, final=True)
    save_progress(done_list, failed, len(all_rows))
    if progress_path().exists() and not failed:
        progress_path().unlink()

    print(f"\nDone: {len(all_rows)} rows, {len(done_list)} products → {OUTPUT_CSV}")
    if failed:
        print(f"Still failed ({len(failed)}): {', '.join(failed[:10])}{'…' if len(failed) > 10 else ''}")


if __name__ == "__main__":
    main()
