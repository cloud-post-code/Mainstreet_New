#!/usr/bin/env python3
"""
Scrape Lekker Home (lekkerhome.com — BigCommerce Stencil).

Crawls top-level category listing pages to collect product URLs, then fetches
each product page and parses the JSON-LD Product schema + BCData block for
SKU, price, stock, brand, description, image. Color/option swatches are
collected from form-option labels and emitted as one CSV row per variant
(matching the variant-per-row schema used by sibling scrape scripts).

Output CSV columns:
  shop_name, product_handle, base_product_name, product_name, product_url,
  variant_id, variant_count, variant_index, option_names, option_values,
  price, quantity, image_url, description_json

Usage:
  python3 scrape_lekkerhome.py
  python3 scrape_lekkerhome.py --resume
"""

from __future__ import annotations

import argparse
import builtins
import csv
import functools
import json
import random
import re
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

DOMAIN = "https://lekkerhome.com"
SHOP_NAME = "Lekker Home"
OUTPUT_CSV = Path(__file__).resolve().parent / "lekkerhome_shop_all.csv"

# Top-level categories (sub-categories roll up into these on the BC nav).
CATEGORIES = [
    "bedroom",
    "decor",
    "dining",
    "lighting",
    "living-room",
    "office",
    "outdoor",
    "rugs",
    "storage",
    "tabletop",
    "new-arrivals",
]

MAX_CATEGORY_PAGES = 50
PRODUCT_DELAY_SEC = 1.2
LISTING_DELAY_SEC = 2.0
MIN_REQUEST_INTERVAL_SEC = 0.8
MAX_RETRIES = 6
BACKOFF_BASE_SEC = 10
BACKOFF_MAX_SEC = 180
SAVE_EVERY_N_PRODUCTS = 50
USER_AGENT = "Mozilla/5.0 (compatible; LekkerHomeCatalog/1.0)"

FIELDNAMES = [
    "shop_name",
    "product_handle",
    "base_product_name",
    "product_name",
    "product_url",
    "variant_id",
    "variant_count",
    "variant_index",
    "option_names",
    "option_values",
    "price",
    "quantity",
    "image_url",
    "description_json",
]

_last_request_at = 0.0


def polite_pause(seconds: float) -> None:
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
                    "Accept": "text/html,application/xhtml+xml,*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            last_err = err
            if err.code in {401, 403, 404, 410}:
                raise
            if attempt < retries - 1:
                wait = backoff_seconds(err, attempt)
                print(f"  HTTP {err.code} on {url}, retry in {wait:.0f}s")
                time.sleep(wait)
            else:
                raise
        except Exception as err:
            last_err = err
            if attempt < retries - 1:
                time.sleep(backoff_seconds(err, attempt))
            else:
                raise
    raise last_err  # type: ignore[misc]


_TAG_RE = re.compile(r"<[^>]+>")


def strip_tags(html_fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html_fragment, flags=re.I)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = _TAG_RE.sub(" ", text)
    text = unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


_CARD_RE = re.compile(
    r'data-entity-id="(?P<eid>\d+)"[^>]*?'
    r'data-name="(?P<name>[^"]+)"[^>]*?'
    r'data-product-category="(?P<cat>[^"]*)"[^>]*?'
    r'data-product-brand="(?P<brand>[^"]*)"[^>]*?'
    r'data-product-price="(?P<price>[^"]*)"',
    re.S,
)
_CARD_LINK_RE = re.compile(
    r'data-entity-id="(\d+)"[\s\S]{0,2000}?'
    r'<a href="(https?://lekkerhome\.com/[^"]+)" class="card-link'
)


def collect_product_urls_from_category(slug: str) -> dict[int, str]:
    """Walk paginated category pages, return {entity_id: product_url}."""
    found: dict[int, str] = {}
    for page in range(1, MAX_CATEGORY_PAGES + 1):
        url = f"{DOMAIN}/{slug}/?page={page}"
        try:
            html = fetch(url, pause_before=LISTING_DELAY_SEC)
        except urllib.error.HTTPError as err:
            print(f"  /{slug}/ page {page}: HTTP {err.code}, stopping")
            break
        new_count = 0
        for m in _CARD_LINK_RE.finditer(html):
            eid = int(m.group(1))
            if eid in found:
                continue
            found[eid] = m.group(2).split("?")[0]
            new_count += 1
        print(f"  /{slug}/ page {page}: +{new_count} new (total {len(found)})")
        if new_count == 0:
            break
        # If pagination shows we're on the last page, stop.
        if f'?page={page + 1}"' not in html and f'?page&#x3D;{page + 1}"' not in html:
            break
    return found


_LDJSON_BLOCK_RE = re.compile(
    r'<script[^>]*type="application/ld\+json"[^>]*>\s*(\{.*?\})\s*</script>',
    re.S,
)
_BCDATA_RE = re.compile(r'var BCData = (\{.*?\});', re.S)
_DATA_LABEL_RE = re.compile(r'data-product-attribute-value="(\d+)" data-label="([^"]*)"')
_ATTR_GROUP_RE = re.compile(
    r'data-product-attribute-name="([^"]+)"[^>]*>(.*?)</fieldset>',
    re.S,
)
_DESC_RE = re.compile(
    r'<div class="productView-description[^"]*"[^>]*>(.*?)</div>\s*<script',
    re.S,
)


def parse_product_page(url: str, html: str) -> list[dict]:
    """Parse a Lekker Home product page HTML and return one row per variant."""
    # Find the Product JSON-LD block.
    product_ld: dict | None = None
    for m in _LDJSON_BLOCK_RE.finditer(html):
        raw = m.group(1)
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("@type") == "Product":
            product_ld = obj
            break
    if not product_ld:
        return []

    name = (product_ld.get("name") or "").strip()
    brand = ((product_ld.get("brand") or {}).get("name") or "").strip()
    description = strip_tags(product_ld.get("description") or "")
    image = product_ld.get("image") or ""
    if isinstance(image, list):
        image = image[0] if image else ""
    sku = product_ld.get("sku") or ""

    offers = product_ld.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    price_raw = str(offers.get("price") or "")
    try:
        price = f"{float(price_raw):.2f}"
    except ValueError:
        price = price_raw
    availability = str(offers.get("availability") or "")
    in_stock = availability.endswith("InStock")

    # Pull entity id and richer price/stock from BCData if available.
    entity_id = ""
    bcdata_match = _BCDATA_RE.search(html)
    if bcdata_match:
        try:
            bcdata = json.loads(bcdata_match.group(1))
            attrs = bcdata.get("product_attributes") or {}
            if attrs.get("sku"):
                sku = sku or attrs["sku"]
            bc_price = (attrs.get("price") or {}).get("without_tax") or {}
            if bc_price.get("value") is not None:
                try:
                    price = f"{float(bc_price['value']):.2f}"
                except (TypeError, ValueError):
                    pass
            if attrs.get("instock") is False:
                in_stock = False
        except json.JSONDecodeError:
            pass

    eid_match = re.search(r'data-product-id="(\d+)"', html) or re.search(
        r'"ProductID":\s*(\d+)', html
    )
    if eid_match:
        entity_id = eid_match.group(1)

    # Variant options — there can be multiple attribute groups (Color, Size, …).
    option_groups: list[tuple[str, list[tuple[str, str]]]] = []
    for fs_match in _ATTR_GROUP_RE.finditer(html):
        attr_name = unescape(fs_match.group(1)).strip()
        block = fs_match.group(2)
        values = [
            (vid, unescape(label).strip())
            for vid, label in _DATA_LABEL_RE.findall(block)
            if label.strip()
        ]
        if values:
            option_groups.append((attr_name, values))

    handle = url.rstrip("/").rsplit("/", 1)[-1]
    description_json_base: dict[str, object] = {}
    if description:
        description_json_base["description"] = description
    if brand:
        description_json_base["brand"] = brand
    if sku:
        description_json_base["sku"] = sku
    if not in_stock:
        description_json_base["in_stock"] = False

    # Flatten variant matrix. Cap at a single dimension to avoid combinatorial
    # explosion on multi-option products — BigCommerce option SKUs aren't
    # exposed in the page, so multi-option products list per-attribute values
    # separately rather than as a cross product.
    rows: list[dict] = []
    if not option_groups:
        desc_json = dict(description_json_base)
        rows.append(
            {
                "shop_name": SHOP_NAME,
                "product_handle": handle,
                "base_product_name": name,
                "product_name": name,
                "product_url": url,
                "variant_id": entity_id,
                "variant_count": "1",
                "variant_index": "1",
                "option_names": "",
                "option_values": "",
                "price": price,
                "quantity": "1" if in_stock else "0",
                "image_url": image,
                "description_json": json.dumps(desc_json, ensure_ascii=False),
            }
        )
        return rows

    # Emit one row per option *value* across all groups (qualified by group
    # name). This keeps the schema flat and matches the variant-per-row format.
    variants: list[tuple[str, str, str]] = []
    for attr_name, values in option_groups:
        for vid, label in values:
            variants.append((attr_name, label, vid))
    variant_count = len(variants)
    for idx, (attr_name, label, vid) in enumerate(variants, start=1):
        desc_json = dict(description_json_base)
        desc_json["option_names"] = attr_name
        desc_json["option_values"] = label
        if variant_count > 1:
            desc_json["variant_group"] = f"{idx} of {variant_count}"
        rows.append(
            {
                "shop_name": SHOP_NAME,
                "product_handle": handle,
                "base_product_name": name,
                "product_name": f"{name} - {label}" if label else name,
                "product_url": url,
                "variant_id": vid,
                "variant_count": str(variant_count),
                "variant_index": str(idx),
                "option_names": attr_name,
                "option_values": label,
                "price": price,
                "quantity": "1" if in_stock else "0",
                "image_url": image,
                "description_json": json.dumps(desc_json, ensure_ascii=False),
            }
        )
    return rows


def scrape_product(url: str) -> list[dict]:
    try:
        html = fetch(url, pause_before=PRODUCT_DELAY_SEC)
    except urllib.error.HTTPError as err:
        print(f"  {url}: HTTP {err.code}, skipping")
        return []
    return parse_product_page(url, html)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scrape Lekker Home catalog")
    p.add_argument("--output", type=Path, default=None)
    p.add_argument("--max-pages", type=int, default=MAX_CATEGORY_PAGES)
    p.add_argument("--delay", type=float, default=PRODUCT_DELAY_SEC)
    p.add_argument("--listing-delay", type=float, default=LISTING_DELAY_SEC)
    p.add_argument("--save-every", type=int, default=SAVE_EVERY_N_PRODUCTS)
    p.add_argument("--resume", action="store_true")
    p.add_argument(
        "--categories",
        nargs="*",
        default=None,
        help="Override category slugs (default: built-in list)",
    )
    return p.parse_args()


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


def save_progress(done: list[str], failed: list[str], row_count: int) -> None:
    progress_path().write_text(
        json.dumps(
            {
                "done_urls": done,
                "failed_urls": failed,
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
        for field in FIELDNAMES:
            row.setdefault(field, "")
    return rows


def done_urls_from_rows(rows: list[dict]) -> set[str]:
    return {row["product_url"] for row in rows if row.get("product_url")}


def load_progress() -> tuple[set[str], list[str]]:
    path = progress_path()
    if not path.exists():
        return set(), []
    data = json.loads(path.read_text(encoding="utf-8"))
    done = set(data.get("done_urls") or [])
    failed = list(data.get("failed_urls") or [])
    print(f"Resuming: {len(done)} URLs done, {len(failed)} previously failed")
    return done, failed


def main() -> None:
    builtins.print = functools.partial(builtins.print, flush=True)  # type: ignore[method-assign]
    args = parse_args()

    global OUTPUT_CSV, MAX_CATEGORY_PAGES, PRODUCT_DELAY_SEC, LISTING_DELAY_SEC
    if args.output:
        OUTPUT_CSV = args.output
    MAX_CATEGORY_PAGES = args.max_pages
    PRODUCT_DELAY_SEC = max(0.5, args.delay)
    LISTING_DELAY_SEC = max(1.0, args.listing_delay)
    categories = args.categories or CATEGORIES

    print(f"Shop: {SHOP_NAME} ({DOMAIN})")
    print(f"Output: {OUTPUT_CSV}")
    print(
        f"Polite mode: {PRODUCT_DELAY_SEC:.1f}s/product, "
        f"{LISTING_DELAY_SEC:.1f}s/listing page, max {MAX_CATEGORY_PAGES} pages/category"
    )

    print("\nCollecting product URLs from categories…")
    url_by_eid: dict[int, str] = {}
    for slug in categories:
        print(f"Category /{slug}/")
        url_by_eid.update(collect_product_urls_from_category(slug))
    product_urls = sorted(set(url_by_eid.values()))
    print(f"\nDiscovered {len(product_urls)} unique product URLs")

    done_urls: set[str] = set()
    failed: list[str] = []
    all_rows: list[dict] = []
    if args.resume:
        done_urls, failed = load_progress()
        all_rows = load_existing_rows()
        if not done_urls and all_rows:
            done_urls = done_urls_from_rows(all_rows)

    remaining = [u for u in product_urls if u not in done_urls]
    save_every = max(1, args.save_every)
    est_min = len(remaining) * PRODUCT_DELAY_SEC / 60
    print(
        f"\nScraping {len(remaining)} products "
        f"({len(done_urls)} skipped), checkpoint every {save_every}, "
        f"~{est_min:.0f} min"
    )

    done_list = list(done_urls)
    since_save = 0
    for i, url in enumerate(remaining, 1):
        rows = scrape_product(url)
        if not rows:
            failed.append(url)
        else:
            all_rows.extend(rows)
            done_list.append(url)
        since_save += 1
        print(
            f"  [{i}/{len(remaining)}] {url.rsplit('/', 1)[-1]}: "
            f"{len(rows)} row(s), {len(all_rows)} total"
        )
        if since_save >= save_every:
            save_csv(all_rows)
            save_progress(done_list, failed, len(all_rows))
            since_save = 0

    save_csv(all_rows, final=True)
    save_progress(done_list, failed, len(all_rows))
    if progress_path().exists() and not failed:
        progress_path().unlink()
    print(f"\nDone: {len(all_rows)} rows, {len(done_list)} products → {OUTPUT_CSV}")
    if failed:
        print(f"Failed ({len(failed)}): {', '.join(failed[:5])}{'…' if len(failed) > 5 else ''}")


if __name__ == "__main__":
    main()
