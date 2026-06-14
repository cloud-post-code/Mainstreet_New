# Plan: Admin Portal — Full Product & Shop Management

**Branch:** main  
**Date:** 2026-05-28  
**Project:** ~/Downloads/Mainstreet_New

---

## What We're Building

The user wants to:
1. Confirm seed data (10 shops × 50 products = 500 total) exists and works
2. Confirm the admin portal frontend is complete with full product/shop listings
3. Add a **separate CSV upload for shops** (currently only one combined import endpoint)
4. Ensure the backend has **paginated** product listing (currently capped at 200)
5. Add a **seed data trigger button** in the admin UI so admins can seed without a DB client
6. Verify the schema is standard and correct

---

## Current State Assessment

### What Already Exists (confirmed by code review)

**Backend:**
- `backend/db/models.py` — `User`, `Shop`, `Product`, `AgentSession`, `AgentTurn`, `AgentPlan`, `UserMemory` — standard SQLAlchemy models with correct FK/cascade
- `backend/db/schemas.py` — Pydantic schemas for all models, `ImportResult`, `ShopOut`, `ProductOut`
- `backend/db/seed.py` — Seeds 10 shops × 50 products = 500 products using Faker(seed=42), deterministic
- `backend/routers/admin.py` — `GET /api/admin/shops`, `DELETE /api/admin/shops/{id}`, `GET /api/admin/products`, `DELETE /api/admin/products/{id}`, `POST /api/admin/import` (combined shop+product CSV), `POST /api/admin/seed`

**Frontend:**
- `frontend/src/pages/Admin.tsx` — Two-tab UI (Shops / Products), CSV import, delete buttons, shop filter on products
- `frontend/src/pages/Admin.module.css` — Styled with Main Street brand (green, cream, terracotta)
- `frontend/src/api.ts` — All admin API methods wired

### Gaps to Fill

1. **No separate CSV upload for shops only** — user wants two separate CSV flows: one for shops, one for products
2. **Products list capped at 200** — `admin.py:151` has `.limit(200)`, need pagination or higher cap for full visibility
3. **No seed trigger button in UI** — the `/api/admin/seed` endpoint exists but Admin.tsx doesn't expose it
4. **Admin products CSV requires `description_json`** — the shop-only CSV should only need `name, logo_url, description, website_url`
5. **`created_at` not shown in admin tables** — minor: useful for audit

---

## Implementation Plan

### Backend Changes

#### 1. Add `/api/admin/import/shops` endpoint
A new CSV endpoint for shop-only imports. Required columns: `name`, optionally `logo_url`, `description`, `website_url`.
Upserts by `name` (same as combined import). Returns `ImportResult`.

#### 2. Increase product listing limit / add offset pagination
Change `GET /api/admin/products` to accept `limit` (default 500, max 1000) and `offset` (default 0) query params. Remove the hardcoded `.limit(200)`.

#### 3. Add shop-specific CSV schema `ShopImportResult`
Same `ImportResult` shape is fine — reuse it.

### Frontend Changes

#### 4. Add "Seed Database" button to Admin.tsx
Calls `POST /api/admin/seed`. Shows result message. Disabled if seed already ran (show count).

#### 5. Add separate "Import Shops via CSV" section
Below the existing product import section, add a second import card: "Import Shops via CSV". Required columns hint: `name, logo_url, description, website_url`. Calls new `/api/admin/import/shops`.

#### 6. Wire pagination to products table
Add "Load more" or page size selector. Default shows first 500 (covers all seeded data).

### api.ts Changes

#### 7. Add `importShopsCsv` method
Mirrors `importCsv` but posts to `/api/admin/import/shops`.

#### 8. Add `seedDatabase` method
Calls `POST /api/admin/seed`, returns `{ status, message }`.

---

## Schema Confirmation

Standard schema — no changes needed. Current models match all requirements:

| Table | Key Fields | Notes |
|---|---|---|
| `users` | id, email, password_hash, is_admin | ✅ correct |
| `shops` | id, name, logo_url, description, website_url | ✅ correct |
| `products` | id, shop_id (FK CASCADE), name, price, quantity, image_url, description (JSONB), search_vector | ✅ correct |
| `agent_sessions` | id, user_id (FK nullable), title, processing | ✅ correct |
| `agent_turns` | id, session_id (FK), role, content (JSONB), tool_calls, tool_results | ✅ correct |
| `agent_plans` | id, session_id (FK), steps (JSONB) | ✅ correct |
| `user_memory` | id, user_id (FK), key, value (JSONB), unique(user_id, key) | ✅ correct |

Seed data: 10 shops × 50 products = 500 products, Faker seed 42, deterministic.

---

## Files to Touch

| File | Change |
|---|---|
| `backend/routers/admin.py` | Add `/import/shops` endpoint; add `limit`/`offset` to products list |
| `frontend/src/api.ts` | Add `importShopsCsv`, `seedDatabase` methods |
| `frontend/src/pages/Admin.tsx` | Add seed button, shops CSV import section, pagination param |

No schema migrations needed — models are correct as-is.

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Keep existing combined import + add separate shops import | Mechanical | P1 (completeness) | User explicitly asked for two separate things | Replacing combined endpoint |
| 2 | Eng | Raise limit to 500 default (covers all seed data) with pagination params | Mechanical | P3 (pragmatic) | 500 covers all seeded products; pagination params future-proof it | Cursor pagination (over-engineered for admin) |
| 3 | Eng | Reuse `ImportResult` schema for shops import | Mechanical | P4 (DRY) | Same shape, no need for a new type | New `ShopImportResult` type |
| 4 | Design | Add seed button at top of admin near import section | Mechanical | P5 (explicit) | Discoverable, not buried; fits existing layout pattern | Separate settings tab |

---

# Plan: AI Scraper Builder — Automated Shop Ingestion

**Date:** 2026-06-13

---

## Goal

Replace the manual CSV workflow with a fully automated pipeline:

```
OLD: URL → admin pastes link → AI digests → export CSV → check CSV → upload CSV → DB
NEW: URL → AI builds scraper → scraper runs → shops + products direct to DB → script saved → re-run anytime
```

When the AI cannot produce a working scraper after max retries, it returns a clear failure message instead of hanging.

---

## Required Output Schema (exactly matches the existing CSV import contract)

The scraper must emit a JSON array where each element is one product variant row — the same fields the existing `POST /api/admin/import` endpoint expects. This means the scraper builder validates against the **complete field set**, not just a subset.

**Required fields (every row must have these):**
```
shop_name           — seller name; for multi-seller sites this is the individual seller/brand
product_handle      — unique slug per parent product (e.g. "blue-canvas-tote")
base_product_name   — parent product title (same across all variants of one product)
product_name        — variant display name (e.g. "Blue Canvas Tote — Large")
price               — decimal string, e.g. "29.99"
quantity            — integer string, e.g. "10" (use "1" when stock count is unknown)
image_url           — absolute URL to the primary product image
description_json    — JSON string of {"summary": "...", "details": [...]} OR plain text summary
```

**Optional fields (include when available on the page):**
```
variant_id          — site's internal variant ID (BigInt); omit or empty string if not available
variant_index       — 1-based integer; use 1 for single-variant products
option_names        — slash-joined option type labels, e.g. "Color / Size"
option_values       — slash-joined option values matching option_names, e.g. "Blue / Large"
parent_store        — marketplace/platform name if applicable (e.g. "Etsy", "Amazon")
```

**Validation rules (all must pass before the script is marked verified):**
1. Every row has all 8 required fields with non-empty values
2. `price` parses as a valid Decimal ≥ 0
3. `quantity` parses as a valid integer ≥ 0
4. `image_url` is an absolute http/https URL
5. `description_json` is either valid JSON or a non-empty string
6. `product_handle` is non-empty and URL-safe (no spaces, lowercase preferred)
7. At least 1 product row scraped (zero rows = failure, not success)
8. Random-sample verification: 3 products picked at random from the scraped set are re-fetched from the live page and cross-checked (see Verification section below)

---

## Seller Type Detection

Before the scraper builder runs, a lightweight **page classifier** determines whether the URL is a single-seller storefront or a multi-seller marketplace. This drives how `shop_name` is populated.

```
classify_seller_type(url, html) -> "single" | "multi" | "unknown"

Signals used (Claude call with small context window):
  - Domain name heuristics: etsy.com, amazon.com, ebay.com → multi
  - Page structure: presence of "Sold by", "Shop:", seller profile links → multi
  - Absence of seller attribution with one consistent brand → single
  - Explicit brand name in <title> or <h1> matching throughout → single

Result stored on ScraperJob.seller_type
```

**How seller_type changes scraper behavior:**

| seller_type | shop_name population strategy |
|---|---|
| `single` | `shop_name` = the brand/shop name from the page (consistent across all products) |
| `multi` | `shop_name` = per-product seller name scraped from each listing |
| `unknown` | Same as `single`; Claude does its best; noted in verification report |

**Shop creation:** after ingestion, the ingestor calls `import_shops` for any shop names that don't already exist in the DB. This is the same upsert logic as `POST /api/admin/import/shops`. Both the Shop row and the Product rows are created in one transaction.

---

## Data Flow

```
Admin UI (Scrapers tab)
  │
  ├─ POST /api/admin/scrapers          ← {url, shop_name (optional override)}
  │
Backend: ScraperJob row created (status=pending)
  │
  └─ Background task
        │
        ├─ Stage 1: Fetch page HTML (httpx, assert_public_http_url)
        │
        ├─ Stage 2: classify_seller_type(url, html) → single | multi | unknown
        │             Emits SSE: {"type":"stage","stage":"classify","result":"single"}
        │
        ├─ Stage 3: Build + Test loop (max 5 attempts)
        │     │
        │     ├─ Claude generates Python scraper script
        │     ├─ subprocess.run(script, timeout=30) → stdout JSON
        │     ├─ Validate all 8 required fields on every row
        │     ├─ Random-sample verification (3 products re-fetched)
        │     │     ├─ PASS → continue to Stage 4
        │     │     └─ FAIL → pass failures back to Claude, retry
        │     │
        │     └─ After 5 attempts OR 3 identical errors:
        │           Emit: {"type":"cannot_scrape","message":"..."}
        │           Mark job: status=cannot_scrape
        │           STOP — do not ingest anything
        │
        ├─ Stage 4: Ingest
        │     ├─ Upsert shops (shop names → Shop rows)
        │     ├─ Upsert products + variants
        │     └─ Commit
        │
        └─ Stage 5: Verification report → SSE + stored on job
              {"type":"success","report":{...}}

SSE stream: GET /api/admin/scrapers/{id}/stream
  events: stage | attempt | validation_error | sample_check | success | cannot_scrape | error
```

---

## New DB Models (migration required)

```python
class ScraperScript(Base):
    __tablename__ = "scraper_scripts"
    id              = Column(Integer, primary_key=True)
    shop_id         = Column(Integer, ForeignKey("shops.id", ondelete="SET NULL"), nullable=True)
    url             = Column(Text, nullable=False)
    script_code     = Column(Text, nullable=False)
    seller_type     = Column(String(10), nullable=True)   # single | multi | unknown
    verified        = Column(Boolean, default=False, nullable=False)
    last_run_at     = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String(20), nullable=True)   # success | error
    last_error      = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

class ScraperJob(Base):
    __tablename__ = "scraper_jobs"
    id              = Column(Integer, primary_key=True)
    shop_id         = Column(Integer, ForeignKey("shops.id", ondelete="SET NULL"), nullable=True)
    script_id       = Column(Integer, ForeignKey("scraper_scripts.id", ondelete="SET NULL"), nullable=True)
    url             = Column(Text, nullable=False)
    shop_name       = Column(String(200), nullable=True)   # admin-provided override
    seller_type     = Column(String(10), nullable=True)    # single | multi | unknown
    status          = Column(String(20), nullable=False, default="pending")
    # pending | running | success | failed | cannot_scrape
    attempts        = Column(Integer, nullable=False, default=0)
    result_summary  = Column(JSONB, nullable=True)         # ScraperVerificationReport
    failure_reason  = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    finished_at     = Column(DateTime(timezone=True), nullable=True)
```

---

## Scraper Builder System Prompt (exact text)

This is the prompt sent to Claude on every attempt. It is explicit, unambiguous, and gives Claude the full field contract in one place.

```
SCRAPER BUILDER SYSTEM PROMPT
==============================

You are a Python web scraping expert. Your job is to write a single self-contained
Python script that scrapes product data from the page provided and prints a JSON
array to stdout.

SELLER TYPE: {seller_type}
  - "single": one brand sells everything on this page. Use the brand/shop name for
    every product's shop_name.
  - "multi": multiple sellers appear on this page (marketplace). Extract the
    per-product seller name for each product's shop_name.
  - "unknown": treat as single seller but do your best.

OUTPUT CONTRACT
---------------
Print ONLY a valid JSON array to stdout. No other text. No logging. No markdown.
Each element of the array is one product VARIANT (a specific color/size/style).
If a product has no variants, emit exactly one element with variant_index = 1.

REQUIRED FIELDS (every element must have all of these):
  shop_name         (string) — seller or brand name
  product_handle    (string) — URL-safe slug, lowercase, hyphens, unique per parent product
                               e.g. "blue-canvas-tote" not "Blue Canvas Tote"
  base_product_name (string) — parent product title, same for all variants of one product
  product_name      (string) — variant display name; if no variants, same as base_product_name
  price             (string) — decimal price, e.g. "29.99"; use "0.00" only if truly free
  quantity          (string) — stock count as integer string; use "1" if stock is not shown
  image_url         (string) — absolute https:// URL to the primary product image
  description_json  (string) — JSON-encoded object: {"summary": "one sentence", "details": ["bullet1", "bullet2"]}
                               If no description exists, use: {"summary": "No description available.", "details": []}

OPTIONAL FIELDS (include if present on the page):
  variant_id    (string) — the site's internal variant ID; omit key or use "" if not available
  variant_index (string) — "1", "2", "3" etc; use "1" for single-variant products
  option_names  (string) — slash-joined option type labels, e.g. "Color / Size"
  option_values (string) — slash-joined option values matching option_names, e.g. "Blue / Large"
  parent_store  (string) — marketplace name if applicable, e.g. "Etsy"

RULES
-----
1. Use only httpx and beautifulsoup4 (bs4). Both are pre-installed. Do not import
   anything else that requires installation.
2. The script must be fully self-contained — no arguments, no user input.
3. Handle pagination: if products span multiple pages, follow next-page links up to
   10 pages. Stop at 10 pages even if more exist.
4. Do not scrape duplicate products (same product_handle = same parent product).
   Variants of the same product are NOT duplicates.
5. If you cannot extract a required field for a product, skip that product entirely
   and continue — do not emit a row with empty required fields.
6. Print ONLY the JSON array. Nothing else to stdout. Errors and warnings go to stderr.
7. Use a descriptive product_handle derived from the product name, not from a DB ID.

CURRENT PAGE URL: {url}
PAGE HTML (first 50000 chars):
{html_excerpt}

{retry_context}
```

`retry_context` is empty on attempt 1. On attempt 2+:
```
PREVIOUS ATTEMPT FAILED
-----------------------
Attempt {n} produced this output:
{previous_stdout_excerpt}

Validation errors:
{validation_errors}

Fix these specific problems and produce a corrected script.
```

---

## Random-Sample Verification

After a script produces valid output, 3 products are chosen at random from the scraped set and individually re-verified against the live page. This catches scripts that hallucinate data or scrape stale cached HTML.

```
verify_sample(scraped_products, script_code, url) -> VerificationResult

For each of 3 randomly-chosen products:
  1. Re-run the script (or a targeted sub-scrape) for that product's URL
  2. Compare: name, price, image_url between scraped vs live
  3. Flag mismatch if: price differs by >$0.01 OR name edit-distance > 20% OR image_url is a 404

VerificationResult:
  passed: bool          — True if all 3 samples match
  sample_results: list  — per-product: {handle, matched_fields, mismatched_fields, live_price, scraped_price}
  mismatch_reason: str  — human-readable explanation if failed
```

If sample verification fails:
- Pass `mismatch_reason` back to Claude as additional `retry_context`
- Counts as one attempt
- After max attempts: `cannot_scrape`

---

## Verification Report

Stored on `ScraperJob.result_summary` and shown in the UI after a successful run.

```python
class ScraperVerificationReport(BaseModel):
    seller_type: str              # single | multi | unknown
    shops_created: int            # new Shop rows created
    shops_updated: int            # existing Shop rows updated
    products_ingested: int        # new Product rows
    products_updated: int         # existing Product rows updated
    variants_ingested: int        # total ProductVariant rows written
    fields_found: list[str]       # required + optional fields that had data
    fields_missing: list[str]     # optional fields absent from all rows
    sample_products: list[dict]   # 3 random products: name, price, image_url, shop_name
    sample_verification: dict     # result of random-sample re-fetch check
    errors: list[dict]            # row-level ingest errors (if any)
    confidence: str               # "high" | "medium" | "low"
    attempts_used: int            # how many build attempts were needed
```

**Confidence heuristic:**
- `high`: all 8 required fields present on every row, 0 ingest errors, 3/3 sample checks passed, 5+ products
- `medium`: some optional fields missing OR 1–3 ingest errors OR sample check had 1 mismatch
- `low`: any required field missing on any row, OR sample check failed 2+ products, OR <5 products

---

## Backend: New Files

### `backend/agent/scraper_builder.py`

```
Functions:
  classify_seller_type(url: str, html: str) -> str
  build_scraper(url, html, seller_type, shop_name_override, max_attempts=5)
      -> AsyncGenerator[SSE event dicts, ...]
  _validate_output(rows: list[dict]) -> list[str]   # returns list of error strings
  _run_script(script_code: str) -> tuple[str, str]  # stdout, stderr
  verify_sample(rows, script_code, url) -> VerificationResult
```

### `backend/agent/scraper_ingestor.py`

```
ingest_scraper_output(db, rows: list[dict]) -> ScraperVerificationReport

Steps:
  1. Collect unique shop names from rows
  2. Upsert each shop (same logic as import_shops_csv in admin.py)
  3. Group rows by (shop_name, product_handle)
  4. Upsert each product + variants (same logic as import_csv in admin.py)
  5. Return ScraperVerificationReport
```

Does NOT duplicate the upsert logic — extracts it into shared helpers in `backend/utils/import_helpers.py` that both `admin.py` and `scraper_ingestor.py` call.

### `backend/utils/import_helpers.py` (new shared module)

Extract the upsert logic currently embedded in `admin.py:import_csv` into:
```
upsert_shop(db, name, logo_url, description, website_url) -> tuple[Shop, bool]  # (shop, created)
upsert_product_group(db, shop, handle, rows) -> tuple[Product, list[ProductVariant], bool]
```

Both `admin.py` and `scraper_ingestor.py` call these. This removes the existing duplication between `import_csv` and `import_shops_csv`.

### `backend/routers/scrapers.py`

```
POST   /api/admin/scrapers              → start job, return ScraperJob
GET    /api/admin/scrapers              → list all jobs + scripts with status
GET    /api/admin/scrapers/{id}         → job detail + result_summary
GET    /api/admin/scrapers/{id}/stream  → SSE progress stream
POST   /api/admin/scrapers/{id}/rerun   → re-run saved script (no AI rebuild)
DELETE /api/admin/scrapers/{id}         → delete job (and script if no other jobs use it)
```

---

## Frontend: New Tab "Scrapers"

Add a fourth tab to `Admin.tsx`:

```
[Stats] [Shops] [Products] [Scrapers]
```

**Scrapers tab layout:**

```
┌─ Start New Scrape ──────────────────────────────────────────┐
│  URL: [https://shop.example.com/collections/all          ]  │
│  Shop name override (optional): [Leave blank to auto-detect]│
│  [Build Scraper ▶]                                          │
└─────────────────────────────────────────────────────────────┘

┌─ Live Progress ─────────────────────────────────────────────┐
│  ✓ Fetched page HTML                                        │
│  ✓ Seller type: single seller (detected: "Taza Chocolate")  │
│  ⟳ Attempt 1/5: generating script...                        │
│    → Validation error: missing image_url on 3 rows          │
│  ⟳ Attempt 2/5: fixing script...                            │
│  ✓ All rows valid                                           │
│  ✓ Sample check: 3/3 products verified against live page    │
│  ✓ Ingested: 2 shops, 47 products, 134 variants             │
└─────────────────────────────────────────────────────────────┘

┌─ Verification Report ───────────────────────────────────────┐
│  Confidence: HIGH   Seller type: single                     │
│  Shops: 1 created   Products: 47   Variants: 134            │
│  Fields: all 8 required ✓   Optional: variant_id missing    │
│  Sample products:                                           │
│  [img] Taza Stone Ground Chocolate Disc — 70% Dark  $8.00   │
│  [img] Taza Wicked Dark Chocolate Bar               $6.00   │
│  [img] Taza Guajillo Chili Chocolate Disc           $8.00   │
└─────────────────────────────────────────────────────────────┘

┌─ Saved Scraper Scripts ─────────────────────────────────────┐
│  URL                          │ Seller │ Shop  │Last Run│    │
│  shop.example.com/collections │ single │ Taza  │ today  │[▶][🗑]│
└─────────────────────────────────────────────────────────────┘
```

**Failure state:**
```
┌─ Cannot Scrape ─────────────────────────────────────────────┐
│  ✗ I cannot build the correct scraping script to gather     │
│    the necessary information from this site.                │
│                                                             │
│  Tried 5 times. Last error:                                 │
│  "image_url could not be extracted — images are loaded      │
│   via JavaScript and are not present in the page HTML."     │
│                                                             │
│  This site likely requires a JavaScript-capable browser.    │
│  [Dismiss]                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Sandbox Security

- `timeout=30` on subprocess — hard SIGKILL after 30 seconds
- Script written to `tempfile.NamedTemporaryFile`, deleted after execution
- `httpx` and `bs4` only — both pre-installed; no pip calls allowed (script validation checks for `import subprocess`, `import os`, `os.system`, `eval(`, `exec(` and rejects if found)
- Page fetches inside scripts go through the existing `assert_public_http_url` check
- Admin-only endpoints (`is_admin=True` required)
- stderr captured and logged but NOT reflected back to the UI (only sanitized validation errors shown)

---

## Files to Create / Modify

| File | Action |
|---|---|
| `backend/db/models.py` | Add `ScraperScript`, `ScraperJob` models |
| `backend/db/schemas.py` | Add `ScraperJobOut`, `ScraperVerificationReport` Pydantic schemas |
| `backend/utils/import_helpers.py` | New — extract `upsert_shop`, `upsert_product_group` from admin.py |
| `backend/routers/admin.py` | Refactor to call `import_helpers` (no behavior change, DRY fix) |
| `backend/agent/scraper_builder.py` | New — classify, build, validate, sample-verify loop |
| `backend/agent/scraper_ingestor.py` | New — ingest validated JSON via import_helpers |
| `backend/routers/scrapers.py` | New — REST + SSE endpoints |
| `backend/main.py` | Register `scrapers` router |
| `frontend/src/api.ts` | Add scraper API methods |
| `frontend/src/pages/Admin.tsx` | Add Scrapers tab |
| `frontend/src/pages/Admin.module.css` | Scraper tab styles |

One Alembic migration: `scraper_scripts` + `scraper_jobs` tables.

---

## NOT in Scope

| Item | Rationale |
|---|---|
| JavaScript rendering (Playwright/Selenium) | Adds heavy deps; static httpx+bs4 covers most product pages; cannot_scrape handles the rest |
| Container/VM sandboxing | Admin-only, Railway already containerized; overkill at this stage |
| Scheduled / cron re-runs | Manual re-run covers the stated need |
| Rate limiting scrape requests | Single admin at a time |
| Multi-user scraper access | Admin-only at this stage |

---

## What Already Exists (reuse opportunities)

| Existing code | How the scraper reuses it |
|---|---|
| `admin.py` upsert logic | Extracted to `import_helpers.py`, called by both flows |
| `agent/upload_safety.py` → `assert_public_http_url` | Blocks SSRF on page fetch + script sub-fetches |
| `agent/streaming.py` → `stream_claude` | Used in scraper_builder for Claude calls |
| `agent/runner.py` background task pattern | ScraperJob background task follows same shape |
| `listing_orchestrator.py` multi-stage streaming | Pattern for stage-by-stage SSE events |

---

## Test Coverage Plan

```
CODE PATHS                                                          STATUS
[+] scraper_builder.py
  ├── classify_seller_type() — single seller signals               [GAP → unit]
  ├── classify_seller_type() — multi seller signals                [GAP → unit]
  ├── _validate_output() — all required fields present             [GAP → unit]
  ├── _validate_output() — missing required field → error          [GAP → unit]
  ├── _validate_output() — bad price (non-decimal) → error         [GAP → unit]
  ├── _validate_output() — bad image_url (relative) → error        [GAP → unit]
  ├── _validate_output() — zero rows → error                       [GAP → unit]
  ├── build_scraper() — happy path (valid on attempt 1)            [GAP → unit]
  ├── build_scraper() — retry (fails once, succeeds attempt 2)     [GAP → unit]
  ├── build_scraper() — max_attempts hit → cannot_scrape           [GAP → unit]
  ├── build_scraper() — 3 identical errors → early cannot_scrape   [GAP → unit]
  ├── build_scraper() — subprocess timeout                         [GAP → unit]
  ├── build_scraper() — forbidden import in script → rejected      [GAP → unit]
  ├── verify_sample() — 3/3 match → passed=True                    [GAP → unit]
  └── verify_sample() — price mismatch → passed=False              [GAP → unit]

[+] import_helpers.py
  ├── upsert_shop() — new shop created                             [GAP → unit]
  ├── upsert_shop() — existing shop updated                        [GAP → unit]
  └── upsert_product_group() — variants upserted correctly         [covered by existing import tests after refactor]

[+] scraper_ingestor.py
  ├── ingest single-seller output → 1 shop + N products            [GAP → integration]
  ├── ingest multi-seller output → M shops + N products            [GAP → integration]
  └── ingest empty output → 0 writes, error returned               [GAP → unit]

[+] routers/scrapers.py
  ├── POST /scrapers → 201, job created                            [GAP → integration]
  ├── POST /scrapers → 401 unauthenticated                         [GAP → integration]
  ├── POST /scrapers → 403 non-admin                               [GAP → integration]
  ├── GET  /scrapers → list with statuses                          [GAP → integration]
  ├── GET  /scrapers/{id}/stream → SSE events emitted              [GAP → integration]
  ├── POST /scrapers/{id}/rerun → 200, re-runs script              [GAP → integration]
  └── DELETE /scrapers/{id} → 204                                  [GAP → integration]

COVERAGE: 0/23 paths tested (all new)
GAPS: 23
```

**Test files:**
- `backend/tests/test_scraper_builder.py` — unit tests, mock Claude + subprocess
- `backend/tests/test_import_helpers.py` — unit tests for extracted upsert helpers
- `backend/tests/integration/test_scraper_flow.py` — integration, mock Claude, real DB

---

## Failure Modes

| Codepath | Failure | Test? | Error handling? | Silent? |
|---|---|---|---|---|
| Page fetch | httpx timeout / 4xx / 5xx | GAP | Mark job `failed`, emit SSE error | No |
| Seller type classify | Claude API error | GAP | Default to `unknown`, continue | No — noted in report |
| Script generation | Forbidden import detected | GAP | Reject script, retry | No |
| Script execution | subprocess timeout 30s | GAP | Mark attempt failed, retry | No |
| Script execution | script raises exception | GAP | Pass stderr to retry context | No |
| Output validation | missing required field | GAP | Pass errors to retry context | No |
| Sample verification | price/name mismatch | GAP | Pass mismatches to retry context | No |
| Max attempts | all 5 attempts fail | GAP | `cannot_scrape` status, clear message | No |
| 3 identical errors | stuck in loop | GAP | Early `cannot_scrape` | No |
| DB ingest | duplicate product_handle | Via import tests | Upsert handles it | No |
| Claude API error (any stage) | anthropic error | GAP | Mark job `failed` | No |

**Critical gap:** 0/11 failure paths have tests. All need coverage before ship.

---

## Parallelization Strategy

| Step | Modules touched | Depends on |
|---|---|---|
| A: DB models + migration | `db/models.py`, `db/schemas.py` | — |
| B: import_helpers.py + admin.py refactor | `utils/import_helpers.py`, `routers/admin.py` | — |
| C: scraper_builder.py | `agent/scraper_builder.py` | — |
| D: scraper_ingestor.py | `agent/scraper_ingestor.py` | A, B |
| E: scrapers router | `routers/scrapers.py` | A, C, D |
| F: Frontend tab | `frontend/` | E (API contract) |
| G: Tests | `tests/` | B, C, D, E |

```
t=0  [A: models]  [B: import_helpers]  [C: scraper_builder]
t=1  [D: ingestor]                     ← after A + B
t=2  [E: router]                       ← after A + C + D
t=3  [F: frontend]  [G: tests]         ← after E
```

---

## Implementation Tasks

- [ ] **T1 (P1, CC: ~10min)** — `db/models.py` + Alembic migration — ScraperScript, ScraperJob
  - Verify: `alembic upgrade head` runs clean
- [ ] **T2 (P1, CC: ~15min)** — `utils/import_helpers.py` — extract upsert_shop, upsert_product_group; update admin.py to call them
  - Verify: existing `test_admin_csv_flow.py` still passes
- [ ] **T3 (P1, CC: ~25min)** — `agent/scraper_builder.py` — classify, build loop, validate (all 8 fields), sample-verify, cannot_scrape fallback
  - Verify: unit tests pass with mocked Claude + subprocess
- [ ] **T4 (P1, CC: ~10min)** — `agent/scraper_ingestor.py` — ingest JSON via import_helpers, build ScraperVerificationReport
  - Verify: integration test inserts shops + products; re-run is idempotent
- [ ] **T5 (P1, CC: ~15min)** — `routers/scrapers.py` — 6 endpoints + SSE + background task
  - Verify: integration tests for all endpoints
- [ ] **T6 (P1, CC: ~20min)** — `frontend/` — Scrapers tab with form, live SSE progress panel, verification report, saved scripts table, re-run, failure state
  - Verify: manual QA against a real product page
- [ ] **T7 (P1, CC: ~15min)** — Tests — `test_scraper_builder.py`, `test_import_helpers.py`, `test_scraper_flow.py`
  - Verify: `pytest backend/tests/test_scraper_builder.py backend/tests/test_import_helpers.py backend/tests/integration/test_scraper_flow.py` passes

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR | 0 issues, 23 test gaps flagged (all new code) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** ENG CLEARED — ready to implement. Run `/ship` when done.
