#!/usr/bin/env python3
"""
Scrape UncommonGoods (uncommongoods.com) into the standard catalog CSV
format used by the other shop scrapers in this directory.

UncommonGoods is NOT a Shopify store. Each product page is server-side
rendered and embeds full product data in a JSON-LD ``Product`` block
(``application/ld+json``) with an ``AggregateOffer`` listing each SKU
variant, plus rendered ``<option>`` tags that carry the variant label
(e.g. "Rechargeable", "Battery Powered"). We parse both.

Product handles (URL slugs) come from the public sitemap.xml
(``https://www.uncommongoods.com/sitemap.xml``), filtered to
``/product/<slug>`` entries.

Output CSV columns match the other scrapers:

  shop_name, product_handle, base_product_name, product_name, product_url,
  variant_id, variant_count, variant_index, option_names, option_values,
  price, quantity, image_url, description_json

Usage:
  python3 scrape_uncommongoods.py
  python3 scrape_uncommongoods.py --resume
  python3 scrape_uncommongoods.py --limit 50         # test on first 50
"""

from __future__ import annotations

import argparse
import builtins
import csv
import functools
import gzip
import io
import json
import random
import re
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

DOMAIN = "https://www.uncommongoods.com"
SHOP_NAME = "UncommonGoods"
SITEMAP_URL = f"{DOMAIN}/sitemap.xml"
OUTPUT_CSV = Path(__file__).resolve().parent / "uncommongoods_shop_all.csv"

PRODUCT_DELAY_SEC = 1.5
MIN_REQUEST_INTERVAL_SEC = 1.0
MAX_RETRIES = 6
BACKOFF_BASE_SEC = 10
BACKOFF_MAX_SEC = 180
SAVE_EVERY_N_PRODUCTS = 100
USER_AGENT = "Mozilla/5.0 (compatible; UncommonGoodsCatalog/1.0; +https://www.uncommongoods.com)"

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


def fetch_bytes(url: str, retries: int = MAX_RETRIES, pause_before: float = MIN_REQUEST_INTERVAL_SEC) -> bytes:
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
                    "Accept-Encoding": "gzip, deflate",
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw
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


def fetch_text(url: str, pause_before: float = MIN_REQUEST_INTERVAL_SEC) -> str:
    return fetch_bytes(url, pause_before=pause_before).decode("utf-8", errors="replace")


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
    return m.group(1).strip().rstrip(".") if m else ""


_PRODUCT_LOC_RE = re.compile(r"<loc>\s*(https?://[^<]+/product/[^<\s?]+)\s*</loc>", re.I)


def collect_handles_from_sitemap() -> list[str]:
    print(f"Fetching sitemap: {SITEMAP_URL}")
    body = fetch_text(SITEMAP_URL, pause_before=0)
    urls = _PRODUCT_LOC_RE.findall(body)
    handles: list[str] = []
    seen: set[str] = set()
    for url in urls:
        # /product/<slug> — slug is path component immediately after /product/
        m = re.search(r"/product/([^/?#]+)", url)
        if not m:
            continue
        slug = m.group(1).strip().lower()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        handles.append(slug)
    print(f"sitemap: found {len(handles)} unique product handles")
    return handles


_LDJSON_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.S | re.I,
)


def find_product_jsonld(html: str) -> dict | None:
    for block in _LDJSON_RE.findall(html):
        text = block.strip()
        if not text:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        candidates: list[dict] = []
        if isinstance(data, list):
            candidates.extend(d for d in data if isinstance(d, dict))
        elif isinstance(data, dict):
            if "@graph" in data and isinstance(data["@graph"], list):
                candidates.extend(d for d in data["@graph"] if isinstance(d, dict))
            else:
                candidates.append(data)
        for cand in candidates:
            typ = cand.get("@type")
            if typ == "Product" or (isinstance(typ, list) and "Product" in typ):
                return cand
    return None


# Map of SKU id -> rendered variant label (text inside the <option>).
_OPTION_RE = re.compile(
    r'<option[^>]*\bvalue=["\'](\d{6,})["\'][^>]*>(.*?)</option>',
    re.S | re.I,
)


def extract_variant_labels(html: str) -> dict[str, str]:
    labels: dict[str, str] = {}
    for sku, inner in _OPTION_RE.findall(html):
        # Strip nested tags (price spans, etc.) and surrounding whitespace.
        text = re.sub(r"<[^>]+>.*?</[^>]+>", " ", inner, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        text = unescape(text).replace("\xa0", " ")
        text = re.sub(r"\$\s*\d[\d,]*(?:\.\d+)?", " ", text)
        text = re.sub(r"\s+", " ", text).strip(" -|/")
        if text:
            labels[sku] = text
    return labels


_BREADCRUMB_RE = re.compile(
    r'"@type"\s*:\s*"BreadcrumbList"[\s\S]*?"itemListElement"\s*:\s*(\[[\s\S]*?\])'
)


def extract_breadcrumbs(html: str) -> list[str]:
    crumbs: list[str] = []
    for block in _LDJSON_RE.findall(html):
        try:
            data = json.loads(block.strip())
        except json.JSONDecodeError:
            continue
        items = []
        if isinstance(data, dict) and data.get("@type") == "BreadcrumbList":
            items = data.get("itemListElement") or []
        elif isinstance(data, dict) and isinstance(data.get("@graph"), list):
            for g in data["@graph"]:
                if isinstance(g, dict) and g.get("@type") == "BreadcrumbList":
                    items = g.get("itemListElement") or []
                    break
        for it in items:
            name = (it.get("name") if isinstance(it, dict) else None) or ""
            if name:
                crumbs.append(name.strip())
        if crumbs:
            break
    return crumbs


def normalize_offers(product_jsonld: dict) -> list[dict]:
    """Return a list of variant offer dicts: {sku, price, url, image, availability}."""
    offers_block = product_jsonld.get("offers")
    out: list[dict] = []

    def push(o: dict) -> None:
        if not isinstance(o, dict):
            return
        sku = o.get("sku")
        price = o.get("price")
        if sku is None and price is None:
            return
        out.append(
            {
                "sku": str(sku) if sku is not None else "",
                "price": str(price) if price is not None else "",
                "url": o.get("url") or "",
                "image": o.get("image") or "",
                "availability": str(o.get("availability") or ""),
            }
        )

    if isinstance(offers_block, dict):
        nested = offers_block.get("offers")
        if isinstance(nested, list) and nested:
            for o in nested:
                push(o)
        else:
            push(offers_block)
    elif isinstance(offers_block, list):
        for o in offers_block:
            push(o)
    return out


def format_price(raw: str) -> str:
    if not raw:
        return ""
    try:
        return f"{float(raw):.2f}"
    except ValueError:
        return raw


def availability_label(avail: str) -> str:
    if not avail:
        return ""
    # schema.org/InStock -> "InStock"
    return avail.rsplit("/", 1)[-1]


def product_url(handle: str, sku: str | None = None) -> str:
    base = f"{DOMAIN}/product/{handle}"
    return f"{base}/{sku}" if sku else base


def handle_from_product_url(url: str) -> str | None:
    m = re.search(r"/product/([^/?#]+)", url or "")
    return m.group(1).lower() if m else None


def scrape_product(handle: str) -> list[dict]:
    page_url = product_url(handle)
    try:
        html = fetch_text(page_url, pause_before=PRODUCT_DELAY_SEC)
    except urllib.error.HTTPError as err:
        print(f"  {handle}: HTTP {err.code}")
        return []

    product = find_product_jsonld(html)
    if not product:
        return []

    title = (product.get("name") or "").strip()
    description_html = product.get("description") or ""
    desc_text = strip_tags(description_html) if "<" in description_html else unescape(description_html).strip()
    made_in = extract_made_in(desc_text)
    fallback_image = ""
    img_field = product.get("image")
    if isinstance(img_field, str):
        fallback_image = img_field
    elif isinstance(img_field, list) and img_field:
        fallback_image = img_field[0] if isinstance(img_field[0], str) else ""
    breadcrumbs = extract_breadcrumbs(html)
    variant_labels = extract_variant_labels(html)
    rating_block = product.get("aggregateRating") or {}
    rating_value = rating_block.get("ratingValue")
    review_count = rating_block.get("reviewCount")

    offers = normalize_offers(product)
    if not offers:
        # Single product with no offer detail — emit one row.
        offers = [{"sku": "", "price": "", "url": page_url, "image": fallback_image, "availability": ""}]

    variant_count = len(offers)
    rows: list[dict] = []
    for idx, offer in enumerate(offers, start=1):
        sku = offer["sku"]
        variant_label = variant_labels.get(sku, "") if sku else ""
        product_name = f"{title} - {variant_label}" if variant_label else title
        option_names = "Option" if variant_label else ""
        option_values = variant_label

        description_json: dict[str, object] = {}
        if desc_text:
            description_json["description"] = desc_text
        if variant_label:
            description_json["variant"] = variant_label
        if variant_count > 1:
            description_json["variant_group"] = f"{idx} of {variant_count}"
        if made_in:
            description_json["made_in"] = made_in
        if breadcrumbs:
            description_json["breadcrumbs"] = breadcrumbs
        if rating_value is not None:
            description_json["rating"] = rating_value
        if review_count is not None:
            description_json["review_count"] = review_count
        availability = availability_label(offer["availability"])
        if availability:
            description_json["availability"] = availability
        if sku:
            description_json["sku"] = sku

        rows.append(
            {
                "shop_name": SHOP_NAME,
                "product_handle": handle,
                "base_product_name": title,
                "product_name": product_name,
                "product_url": offer["url"] or product_url(handle, sku or None),
                "variant_id": sku,
                "variant_count": str(variant_count),
                "variant_index": str(idx),
                "option_names": option_names,
                "option_values": option_values,
                "price": format_price(offer["price"]),
                "quantity": "1",
                "image_url": offer["image"] or fallback_image,
                "description_json": json.dumps(description_json, ensure_ascii=False),
            }
        )
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape UncommonGoods catalog")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--delay", type=float, default=PRODUCT_DELAY_SEC)
    parser.add_argument("--save-every", type=int, default=SAVE_EVERY_N_PRODUCTS)
    parser.add_argument("--limit", type=int, default=0, help="Only scrape first N products (0 = all)")
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


def configure(output: Path | None, product_delay: float) -> None:
    global OUTPUT_CSV, PRODUCT_DELAY_SEC
    if output:
        OUTPUT_CSV = output
    PRODUCT_DELAY_SEC = max(0.5, product_delay)


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
                "site": "uncommongoods",
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
        for field in FIELDNAMES:
            row.setdefault(field, "")
    return rows


def done_handles_from_rows(rows: list[dict]) -> set[str]:
    done: set[str] = set()
    for row in rows:
        handle = (row.get("product_handle") or "").strip().lower()
        if handle:
            done.add(handle)
            continue
        h = handle_from_product_url(row.get("product_url") or "")
        if h:
            done.add(h)
    return done


def load_progress() -> tuple[set[str], list[str]]:
    path = progress_path()
    if not path.exists():
        return set(), []
    data = json.loads(path.read_text(encoding="utf-8"))
    done = set(data.get("done_handles") or [])
    failed = list(data.get("failed_handles") or [])
    print(f"Resuming: {len(done)} products already done, {len(failed)} previously failed")
    return done, failed


def main() -> None:
    builtins.print = functools.partial(builtins.print, flush=True)  # type: ignore[method-assign]
    args = parse_args()
    configure(args.output, args.delay)
    print(f"Site: {DOMAIN}")
    print(f"Output: {OUTPUT_CSV}")
    print(f"Polite mode: {PRODUCT_DELAY_SEC:.1f}s between products")

    handles = collect_handles_from_sitemap()
    if args.limit and args.limit > 0:
        handles = handles[: args.limit]
        print(f"Limit applied: scraping first {len(handles)} products")

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
            print(f"Loaded {len(all_rows)} existing rows from {OUTPUT_CSV}")

    remaining = [h for h in handles if h not in done_handles]
    est_min = len(remaining) * PRODUCT_DELAY_SEC / 60
    print(
        f"\nScraping {len(remaining)} products "
        f"({len(done_handles)} skipped), checkpoint every {save_every}, "
        f"~{est_min:.0f} min at current delay…"
    )

    done_list: list[str] = list(done_handles)
    products_since_save = 0

    for handle in remaining:
        try:
            rows = scrape_product(handle)
        except urllib.error.HTTPError as err:
            print(f"  {handle}: HTTP {err.code}, skipping")
            rows = []
        except Exception as err:
            print(f"  {handle}: {type(err).__name__}: {err}, skipping")
            rows = []

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

    if failed:
        print(f"\nRetrying {len(failed)} products that returned no rows…")
        polite_pause(PRODUCT_DELAY_SEC * 2)
        retry_failed: list[str] = []
        for i, handle in enumerate(failed, 1):
            try:
                rows = scrape_product(handle)
            except Exception:
                rows = []
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
