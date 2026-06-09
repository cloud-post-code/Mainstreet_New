#!/usr/bin/env python3
"""
Scrape Blackstone's of Beacon Hill (blackstonesboston.com) — an Ecwid
storefront — and emit the same CSV format used by the Topdrawer/Boston General
Store scrapers so the existing upload pipeline can ingest it:

  shop_name, product_handle, base_product_name, product_name, product_url,
  variant_id, variant_count, variant_index, option_names, option_values,
  price, quantity, image_url, description_json

Source of truth: schema.org JSON-LD embedded in each product page (rendered
server-side by Ecwid). Product URLs come from the public sitemap.xml. The
storefront does not expose variants in the JSON-LD, so each product yields a
single row (variant_count=1).

Usage:
  python3 scrape_blackstones_shop_all.py
  python3 scrape_blackstones_shop_all.py --resume
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

DOMAIN = "https://blackstonesboston.com"
SITEMAP_URL = f"{DOMAIN}/sitemap.xml"
OUTPUT_CSV = Path(__file__).resolve().parent / "blackstones_shop_all.csv"
PRODUCT_DELAY_SEC = 1.0
MIN_REQUEST_INTERVAL_SEC = 0.6
MAX_RETRIES = 8
BACKOFF_BASE_SEC = 8
BACKOFF_MAX_SEC = 180
SAVE_EVERY_N_PRODUCTS = 100
USER_AGENT = "Mozilla/5.0 (compatible; BlackstonesCatalog/1.0; +https://blackstonesboston.com)"
DEFAULT_SHOP_NAME = "Blackstone's of Beacon Hill"

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
    jitter = random.uniform(0.1, 0.4)
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
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            last_err = err
            if err.code in {400, 401, 403, 404, 410}:
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


def strip_tags(html_fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html_fragment, flags=re.I)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


_MADE_IN_RE = re.compile(r"\bMade in ([A-Z][A-Za-z .,'\-]+?)(?:[\.\n,]|$)")


def extract_made_in(text: str) -> str:
    m = _MADE_IN_RE.search(text)
    if not m:
        return ""
    return m.group(1).strip().rstrip(".")


def collect_product_urls() -> list[str]:
    print("Fetching sitemap…")
    xml = fetch(SITEMAP_URL)
    urls = re.findall(r"https://blackstonesboston\.com/products/[a-z0-9][a-z0-9-]*", xml)
    seen: set[str] = set()
    ordered: list[str] = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        ordered.append(u)
    print(f"Sitemap: {len(ordered)} unique product URLs")
    return ordered


_LDJSON_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.S | re.I,
)


def extract_product_ldjson(html: str) -> dict | None:
    for m in _LDJSON_RE.finditer(html):
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            if not isinstance(item, dict):
                continue
            t = item.get("@type")
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                return item
    return None


def first_image_url(ld: dict) -> str:
    images = ld.get("image")
    if not images:
        return ""
    if isinstance(images, str):
        return images
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return first.get("contentUrl") or first.get("url") or ""
    if isinstance(images, dict):
        return images.get("contentUrl") or images.get("url") or ""
    return ""


def get_offer_field(offers, key: str) -> str:
    if not offers:
        return ""
    candidates = offers if isinstance(offers, list) else [offers]
    for offer in candidates:
        if isinstance(offer, dict) and offer.get(key) is not None:
            return str(offer[key])
    return ""


def get_seller_name(offers) -> str:
    if not offers:
        return ""
    candidates = offers if isinstance(offers, list) else [offers]
    for offer in candidates:
        if not isinstance(offer, dict):
            continue
        seller = offer.get("seller")
        if isinstance(seller, dict):
            name = seller.get("name")
            if name:
                return str(name)
        elif isinstance(seller, str):
            return seller
    return ""


def get_brand_name(ld: dict) -> str:
    brand = ld.get("brand")
    if isinstance(brand, str):
        return brand
    if isinstance(brand, dict):
        return str(brand.get("name") or "")
    if isinstance(brand, list) and brand:
        first = brand[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return str(first.get("name") or "")
    return ""


def availability_to_quantity(availability: str) -> str:
    a = (availability or "").lower()
    if "outofstock" in a or "out_of_stock" in a:
        return "0"
    return "1"


def handle_from_url(url: str) -> str:
    m = re.search(r"/products/([a-z0-9][a-z0-9-]*)", url)
    return m.group(1) if m else ""


def scrape_product(url: str) -> list[dict]:
    try:
        html = fetch(url, pause_before=PRODUCT_DELAY_SEC)
    except urllib.error.HTTPError as err:
        print(f"  HTTP {err.code} — skipping {url}")
        return []

    ld = extract_product_ldjson(html)
    if not ld:
        return []

    name = str(ld.get("name") or "").strip()
    if not name:
        return []

    desc_html = str(ld.get("description") or "")
    desc_text = strip_tags(desc_html)
    made_in = extract_made_in(desc_text)
    brand = get_brand_name(ld)
    sku = str(ld.get("sku") or "").strip()
    gtin = str(ld.get("gtin12") or ld.get("gtin13") or ld.get("gtin") or "").strip()

    offers = ld.get("offers")
    price_raw = get_offer_field(offers, "price")
    try:
        price = f"{float(price_raw):.2f}" if price_raw else ""
    except ValueError:
        price = price_raw
    availability = get_offer_field(offers, "availability")
    quantity = availability_to_quantity(availability)
    seller = get_seller_name(offers) or DEFAULT_SHOP_NAME

    image_url = first_image_url(ld)
    handle = handle_from_url(url)

    description_json: dict[str, object] = {}
    if desc_text:
        description_json["description"] = desc_text
    if brand:
        description_json["brand"] = brand
    if made_in:
        description_json["made_in"] = made_in
    if sku:
        description_json["sku"] = sku
    if gtin:
        description_json["gtin"] = gtin
    if availability:
        description_json["availability"] = availability

    row = {
        "shop_name": seller,
        "product_handle": handle,
        "base_product_name": name,
        "product_name": name,
        "product_url": url,
        "variant_id": "",
        "variant_count": "1",
        "variant_index": "1",
        "option_names": "",
        "option_values": "",
        "price": price,
        "quantity": quantity,
        "image_url": image_url,
        "description_json": json.dumps(description_json, ensure_ascii=False),
    }
    return [row]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Blackstone's of Beacon Hill")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--delay", type=float, default=PRODUCT_DELAY_SEC)
    parser.add_argument("--save-every", type=int, default=SAVE_EVERY_N_PRODUCTS)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N products (debug)")
    return parser.parse_args()


def configure(output: Path | None, product_delay: float) -> None:
    global OUTPUT_CSV, PRODUCT_DELAY_SEC
    if output:
        OUTPUT_CSV = output
    PRODUCT_DELAY_SEC = max(0.4, product_delay)


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


def save_progress(done_urls: list[str], failed_urls: list[str], row_count: int) -> None:
    progress_path().write_text(
        json.dumps(
            {
                "done_urls": done_urls,
                "failed_urls": failed_urls,
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
    return {(r.get("product_url") or "").strip() for r in rows if r.get("product_url")}


def load_progress() -> tuple[set[str], list[str]]:
    path = progress_path()
    if not path.exists():
        return set(), []
    data = json.loads(path.read_text(encoding="utf-8"))
    done = set(data.get("done_urls") or [])
    failed = list(data.get("failed_urls") or [])
    print(f"Resuming: {len(done)} done, {len(failed)} previously failed")
    return done, failed


def main() -> None:
    builtins.print = functools.partial(builtins.print, flush=True)  # type: ignore[method-assign]
    args = parse_args()
    configure(args.output, args.delay)
    print(f"Site: {DOMAIN}")
    print(f"Output: {OUTPUT_CSV}")
    print(f"Delay: {PRODUCT_DELAY_SEC:.1f}s between products")

    urls = collect_product_urls()
    if args.limit:
        urls = urls[: args.limit]
        print(f"Limit applied: scraping first {len(urls)} URLs")

    save_every = max(1, args.save_every)
    done_urls: set[str] = set()
    all_rows: list[dict] = []
    failed: list[str] = []
    if args.resume:
        done_urls, failed = load_progress()
        all_rows = load_existing_rows()
        if not done_urls and all_rows:
            done_urls = done_urls_from_rows(all_rows)
        if done_urls:
            print(f"Loaded {len(all_rows)} existing rows from {OUTPUT_CSV}")

    remaining = [u for u in urls if u not in done_urls]
    est_min = len(remaining) * PRODUCT_DELAY_SEC / 60
    print(
        f"\nScraping {len(remaining)} products "
        f"({len(done_urls)} skipped), checkpoint every {save_every}, "
        f"~{est_min:.0f} min at current delay…"
    )

    done_list: list[str] = list(done_urls)
    products_since_save = 0

    for url in remaining:
        rows = scrape_product(url)
        if not rows:
            failed.append(url)
        else:
            all_rows.extend(rows)
            done_list.append(url)
        products_since_save += 1
        print(
            f"  [{len(done_list)}/{len(urls)}] {handle_from_url(url)}: "
            f"{len(rows)} row(s), {len(all_rows)} total"
        )

        if products_since_save >= save_every:
            save_csv(all_rows)
            save_progress(done_list, failed, len(all_rows))
            products_since_save = 0

    if failed:
        print(f"\nRetrying {len(failed)} products that returned no rows…")
        retry_failed: list[str] = []
        for i, url in enumerate(failed, 1):
            rows = scrape_product(url)
            if rows:
                all_rows.extend(rows)
                done_list.append(url)
            else:
                retry_failed.append(url)
            print(f"  [retry {i}/{len(failed)}] {handle_from_url(url)}: {len(rows)} row(s)")
        failed = retry_failed

    save_csv(all_rows, final=True)
    save_progress(done_list, failed, len(all_rows))
    if progress_path().exists() and not failed:
        progress_path().unlink()

    print(f"\nDone: {len(all_rows)} rows, {len(done_list)} products → {OUTPUT_CSV}")
    if failed:
        print(f"Still failed ({len(failed)}): {', '.join(failed[:5])}{'…' if len(failed) > 5 else ''}")


if __name__ == "__main__":
    main()
