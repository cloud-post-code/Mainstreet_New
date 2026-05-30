<!-- /autoplan restore point: /Users/christophermauri/.gstack/projects/cloud-post-code-Mainstreet_New/main-autoplan-restore-20260528-152526.md -->

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
