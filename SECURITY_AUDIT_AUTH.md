# Security Audit — Authentication & Authorization

| Field | Value |
| --- | --- |
| Scope | Authentication & authorization surface of `Mainstreet_New` (FastAPI backend + React/Vite frontend) |
| Method | Static code review (read-only). No live probing, no fuzzing. |
| Commit reviewed | `d0601f0b4ac02ee4375a1c85a9a997ab153d2fb7` (branch `main`) |
| Date | 2026-06-07 |
| Auditor | Claude (Opus 4.7) |

---

## 1. Executive Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 4 |
| Info | 3 |

**Top 3 risks:**

1. **JWT has no `iat`, no `nbf`, and there is no revocation mechanism.** Token lifetime is 24 hours and the only way to invalidate a stolen token is to wait for it to expire or rotate `SECRET_KEY` (which invalidates *everyone*). There is no `/logout`, no token blacklist, no `password_changed_at` claim. — **High**
2. **Tokens live in `localStorage`, accessible to any same-origin JavaScript.** A single XSS — including one introduced via a future dependency or markdown-render feature — promotes to full account takeover for any active session. There are no current XSS sinks, which is the only reason this is rated High rather than Critical. — **High**
3. **`POST /api/admin/import/shops` reads the upload uncapped** (`content = await file.read()`, `admin.py:310`) while the sibling `POST /api/admin/import` uses `read_capped(..., MAX_CSV_BYTES)`. An authenticated admin (or any attacker who has compromised admin credentials) can OOM the API process. Defense-in-depth gap rather than a remote-unauth issue. — **Medium**

The codebase already gets a lot right: bcrypt via passlib, server-side 12-char password minimum, generic auth error messages, slowapi rate limiting on register/login, properly parameterized SQL, real Stripe webhook signature verification (`stripe.Webhook.construct_event`), SSRF guard with private-range checks, magic-byte image validation that rejects SVG, an explicit anti-mass-assignment test for `is_admin`, an explicit IDOR-guard test for cart `session_id` forgery, and a startup assertion that `SECRET_KEY` is ≥32 chars. The findings below are mostly hardening and lifecycle gaps, not bypasses.

---

## 2. Methodology & Scope

**Reviewed:**

- All FastAPI routers in `backend/routers/` (auth, cart, agent, inbox, admin, listing_agent, products, shops, mason_memory).
- Auth core: `backend/auth.py`, `backend/config.py`, `backend/main.py`.
- Data model: `backend/db/models.py`, `backend/db/schemas.py`.
- Existing security regressions: `backend/tests/test_security.py`.
- Frontend token handling: `frontend/src/api.ts`, `frontend/src/hooks/useAuth.tsx`, all `frontend/src/**` searched for `localStorage`, `dangerouslySetInnerHTML`, and `innerHTML`.
- Git index for tracked `.env*` files and `.gitignore` coverage.

**Not in scope (out of audit):**

- Agent prompt-injection surface beyond what affects auth boundaries (already partially covered by `prompt_safety.wrap_untrusted`).
- Vector-search relevance / data quality.
- Infrastructure (Railway TLS termination, network ACLs, DB user privileges).
- Dependency-CVE scanning (no `pip-audit` / `npm audit` was run).
- Payment correctness beyond webhook trust (no review of refund or partial-fulfillment flows).

---

## 3. Findings

### H-1 — No token revocation, no `iat`/`nbf`, 24-hour lifetime  ·  **High**  ·  AuthN / Session

**Evidence**

```python
# backend/auth.py:25-27
def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expire}, settings.secret_key, algorithm=settings.algorithm)
```

```python
# backend/config.py:9
access_token_expire_minutes: int = 60 * 24
```

- Token claims are exactly `{"sub", "exp"}` — no `iat`, no `nbf`, no `jti`.
- No `/api/auth/logout` exists (`backend/routers/auth.py` has only `/register`, `/login`, `/me`).
- `User` model has no `password_changed_at` or `tokens_invalid_after` column (`db/models.py:14-25`), so a password change does not invalidate outstanding tokens.

**Impact**

A stolen token (XSS, phished, exfiltrated from a shared machine, leaked via browser-extension, or read from a backup of `localStorage`) is valid for up to 24 hours and **cannot be revoked** without rotating `SECRET_KEY` (which logs every user out). The user has no defensive action available; even changing their password leaves the stolen token live.

**Recommendation**

Smallest credible fix, in order of effort:

1. Add `iat` and a `jti` claim in `create_access_token`. `jti` enables a future per-token revocation list.
2. Add a `tokens_invalid_after: DateTime` column on `User`. In `get_current_user`, reject tokens whose `iat` is older than `user.tokens_invalid_after`. Set it on password change, on explicit logout-everywhere, and on admin-flag changes. This gives revocation without a Redis blacklist.
3. Add a `POST /api/auth/logout-everywhere` endpoint that bumps `tokens_invalid_after = now()`.
4. Shorten `access_token_expire_minutes` to ~60 and add a refresh token (HttpOnly cookie) — the existing `config.py:8` comment already names this as the long-term plan.

### H-2 — JWT stored in `localStorage`; any XSS = full account takeover  ·  **High**  ·  Session / XSS

**Evidence**

```ts
// frontend/src/hooks/useAuth.tsx:20-44
const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
...
localStorage.setItem('token', t)
localStorage.setItem('user', JSON.stringify(u))
```

```ts
// frontend/src/api.ts:9-11
export function clearStoredAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}
```

A grep of `frontend/src` finds **zero** uses of `dangerouslySetInnerHTML` or `innerHTML=`, and no markdown renderer (`react-markdown`, `marked`, `DOMPurify`) is currently imported. So today there is no in-tree XSS sink. The risk is structural, not exploited.

**Impact**

The first XSS regression — a new markdown-rendered field in `inbox.body`, an unescaped chat content blob, a vulnerable npm dependency, a chrome extension reading storage on the active tab — promotes directly to account takeover, since the attacker can read the token from `localStorage`, post it to their own server, and impersonate the user for up to 24 hours (see H-1) without any further interaction.

**Recommendation**

- Migrate to an HttpOnly, `Secure`, `SameSite=Lax` (or `Strict`) cookie carrying the access token. The CORS config already sets `allow_credentials=True` (`main.py:65`), so the wiring exists. Add a CSRF defense (double-submit token or per-request header check) at the same time.
- Until that migration: add a strict `Content-Security-Policy` response header (`script-src 'self'`, no `unsafe-inline`, no `unsafe-eval`) so a future XSS has nowhere to inject. Also avoid introducing any markdown/HTML renderer for user- or LLM-supplied content without sanitization (`DOMPurify`).

### M-1 — `import/shops` reads the upload body uncapped  ·  **Medium**  ·  AuthZ-adjacent DoS

**Evidence**

```python
# backend/routers/admin.py:301-311
@router.post("/import/shops", response_model=ImportResult)
async def import_shops_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    text = content.decode("utf-8-sig")
```

The sibling product-import endpoint already does it correctly:

```python
# backend/routers/admin.py:104
content = await read_capped(file, MAX_CSV_BYTES)
```

**Impact**

Authenticated admin can OOM the worker. Blast radius is limited because the route requires `get_admin_user`, but the existing capped helper is one line away, making this a free fix. Also useful if an admin token is ever leaked.

**Recommendation**

Change line 310 to `content = await read_capped(file, MAX_CSV_BYTES)` (already imported via `from agent.upload_safety import read_capped, validate_image_bytes` on line 12).

### M-2 — Rate limiter keyed on `get_remote_address` will see the wrong IP behind Railway's proxy  ·  **Medium**  ·  AuthN / Rate limiting

**Evidence**

```python
# backend/routers/auth.py:13
limiter = Limiter(key_func=get_remote_address)
```

`slowapi.util.get_remote_address` returns `request.client.host`. In production behind Railway's load balancer, every request originates from a handful of edge IPs, so:

- All login attempts share the same limiter key → a single bad actor can lock out the whole platform's login throughput. (5/min register, 10/min login are global per edge IP.)
- Or worse, if Starlette is configured (now or later) with `ProxyHeadersMiddleware` trusting `X-Forwarded-For` unconditionally, the limiter becomes trivially bypassable by spoofing that header.

`main.py` does **not** currently install `ProxyHeadersMiddleware`, so the first variant (over-blocking) is the live behavior.

**Impact**

DoS amplification on login (one attacker shares the bucket with all legitimate users on the same edge IP) and, if a proxy-headers middleware is added without an explicit `trusted_hosts` allowlist, full bypass.

**Recommendation**

- Define an explicit `key_func` that combines the trimmed `X-Forwarded-For` first hop (only when the request came from a known proxy) with the request body's `email` field for login/register so the limit follows the credential, not just the network path.
- If/when `ProxyHeadersMiddleware` is added, pass `trusted_hosts=["<railway internal CIDR>"]`, not `"*"`.
- Also add a slowapi limit on `/api/cart/checkout` and `/api/admin/listing/draft` (the latter is admin-only but spins up LLM calls per invocation — a single compromised admin token can run up a bill).

### M-3 — JWT `sub` accepted as any string and cast to int without validation  ·  **Medium**  ·  AuthN

**Evidence**

```python
# backend/auth.py:36-47
payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
user_id: Optional[str] = payload.get("sub")
if user_id is None:
    raise credentials_exception
...
result = await db.execute(select(User).where(User.id == int(user_id)))
```

`int(user_id)` raises `ValueError` for non-numeric strings; that is **not** caught (only `JWTError` is). A token that decodes successfully but has a non-numeric `sub` produces a 500, not a 401. `get_optional_user` does catch `ValueError` (`auth.py:66`), but `get_current_user` does not.

**Impact**

Low direct severity (anyone who can forge such a token already holds the signing secret), but the inconsistency hides bugs: a future migration that issues string user IDs would crash every authenticated request with a 500 instead of failing gracefully, and uncaught exceptions are noisier to monitor.

**Recommendation**

Catch `ValueError` alongside `JWTError` in `get_current_user` (mirror `get_optional_user:66`), or validate `sub` is numeric before the cast and raise `credentials_exception` if not.

### M-4 — No idempotency on Stripe `checkout.session.completed` handler  ·  **Medium**  ·  Webhook

**Evidence**

```python
# backend/routers/cart.py:445-455
if event["type"] == "checkout.session.completed":
    stripe_session = event["data"]["object"]
    ref = stripe_session.get("client_reference_id")
    if ref:
        try:
            user_id = int(ref)
        except ValueError:
            user_id = None
        if user_id is not None:
            await db.execute(delete(CartItem).where(_owner_filter(user_id, None)))
            await db.commit()
```

Today the handler only deletes the cart — which is idempotent (`delete` of an empty cart is a no-op). But there is no `event["id"]` dedupe table, so the moment this handler grows to write an `orders` row, decrement inventory, mark a fulfillment, or send an email, a Stripe retry (which is normal — Stripe retries on any non-2xx, network blip, or timeout) will double-execute.

**Impact**

Today: none. The risk is that the next code change here introduces double-charge or double-fulfill semantics, and there is no scaffolding to prevent it.

**Recommendation**

Before adding any side effect beyond the existing cart-clear, add a `processed_stripe_events` table keyed on `event["id"]` with a `UNIQUE` constraint and skip handling if insert raises `IntegrityError`. Cheaper alternative: use `event["idempotency_key"]` on the Stripe side and dedupe by that.

### M-5 — `User.id` cart filtering relies on a partial unique index, not application logic  ·  **Medium**  ·  AuthZ

**Evidence**

```python
# backend/db/models.py:258-271 — CartItem
__table_args__ = (
    Index(
        "ix_cart_user_variant", "user_id", "variant_id", unique=True,
        postgresql_where=text("user_id IS NOT NULL"),
    ),
    Index(
        "ix_cart_session_variant", "session_id", "variant_id", unique=True,
        postgresql_where=text("session_id IS NOT NULL AND user_id IS NULL"),
    ),
    CheckConstraint(
        "(user_id IS NOT NULL) OR (session_id IS NOT NULL)",
        name="cart_owner_required",
    ),
)
```

```python
# backend/routers/cart.py:36-39
def _owner_filter(user_id: int | None, session_id: int | None):
    if user_id is not None:
        return CartItem.user_id == user_id
    return and_(CartItem.session_id == session_id, CartItem.user_id.is_(None))
```

The HTTP routes (`cart.py:351-428`) all pass `session_id=None`, so the wire never controls ownership — good. The agent tool dispatcher is the other caller (`cart.py:7` docstring notes this). Verify in implementation reviews that the agent never lets a user (via prompt) pass a `session_id` belonging to someone else into `add_item`, `set_quantity`, or `remove_item`. The existing `test_security.test_cart_addItem_schema_rejects_session_id` covers the HTTP path only.

**Impact**

Currently no exploit identified; risk is that a future agent-tool change that accepts a guest `session_id` parameter would let an authenticated user (or even a prompt-injecting product page) write into another guest's cart.

**Recommendation**

- Tighten the agent tool surface so `session_id` is **always** sourced from the agent loop's session context, never from user/LLM-supplied tool arguments.
- Add a regression test analogous to `test_cart_addItem_schema_rejects_session_id` for the agent tool dispatcher.

### M-6 — Inbox `POST /:id/open` creates a session for the message owner without verifying the body matches a current user — minor cross-feature coupling  ·  **Medium**  ·  AuthZ (defense-in-depth)

**Evidence**

```python
# backend/routers/inbox.py:47-82
@router.post("/{message_id}/open", response_model=InboxOpenOut)
async def open_inbox_message(message_id: int, ..., current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(InboxMessage).where(
            InboxMessage.id == message_id,
            InboxMessage.user_id == current_user.id,
        )
    )
    msg = result.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if not msg.session_id:
        session = AgentSession(user_id=current_user.id, title=msg.title)
        ...
        turn = AgentTurn(session_id=session.id, role="assistant",
                         content=[{"type": "text", "text": msg.body}])
```

Ownership is correctly filtered. The concern is **stored-XSS by way of agent rendering**: `msg.body` is written verbatim into an `AgentTurn` of role `assistant`, which the frontend will later render via the agent chat surface. If `msg.body` is ever populated from an attacker-controllable source (e.g., a future "share a link to a product" inbox notifier, an agent that summarizes user input into an inbox card, or admin-uploaded campaign content), the frontend chat renderer needs to treat that content as untrusted.

**Impact**

Latent stored-XSS path that depends on whether the chat renderer ever interprets HTML/markdown. No active issue today (no markdown lib imported), but tied directly to H-2 — if a renderer is added later without sanitization, an inbox poison feeds into it.

**Recommendation**

- Document in `inbox.py` that `body` is rendered as `text` only and add a content-type discriminator on `AgentTurn.content` items so any future markdown render is opt-in per content item, not per renderer default.
- When adding any LLM/markdown renderer for chat, sanitize via `DOMPurify` (frontend) **and** mark turn content as `untrusted` whenever its origin isn't the agent itself.

### L-1 — Email enumeration via timing on `/login`  ·  **Low**  ·  AuthN

**Evidence**

```python
# backend/routers/auth.py:39-43
async def login(...):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalars().first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
```

`verify_password` only runs when `user` exists. bcrypt is slow (intentionally), so the response time difference between "no such user" (fast — one DB query) and "user exists, password wrong" (slow — one DB query + bcrypt) is large enough to enumerate emails over time.

**Impact**

An attacker can confirm which emails are registered, then target the platform with credential-stuffing or phishing tailored to known users.

**Recommendation**

When `user is None`, still call `pwd_context.verify(body.password, _DUMMY_HASH)` (a precomputed bcrypt hash of a random string) and discard the result before raising. This equalizes timing.

### L-2 — `EmailStr` rejects valid addresses some users have, but does not normalize  ·  **Low**  ·  AuthN

**Evidence**

`UserRegister.email: EmailStr` (`schemas.py:11`). Email is stored verbatim. A user registering `Alice@Example.com` and another registering `alice@example.com` create two separate accounts — the database unique constraint on `email` is byte-exact (`models.py:18`).

**Impact**

Account-confusion: two users with the same conceptual email but different case can both exist, breaking password reset, support workflows, and any future SSO mapping.

**Recommendation**

Lowercase the email in a Pydantic validator on both `UserRegister` and `UserLogin`, and backfill existing rows.

### L-3 — Listing-draft `image_url` is sent to the LLM and re-fetched without re-validating it with the SSRF guard  ·  **Low**  ·  Webhook / SSRF (admin-only)

**Evidence**

```python
# backend/routers/listing_agent.py:81-103
async def draft_listing(body: DraftRequest, ...):
    shop = (await db.execute(select(Shop).where(Shop.id == body.shop_id))).scalars().first()
    ...
    async for evt in run_listing_agent(
        shop_name=shop.name,
        image_url=body.image_url,  # ← arbitrary string from request body
        ...
    )
```

`DraftRequest.image_url: str` — there is no call to `assert_public_http_url(body.image_url)` at the router boundary. The intended source is `POST /upload-image`, which returns a URL on the app's own domain, but the body field is free-form and admin-supplied. The deeper layer (`run_listing_agent`) is out of scope for this audit; please confirm it either validates or passes the URL only to OpenAI/Anthropic vision (which would handle the fetch).

**Impact**

Admin can pass an internal URL (e.g., `http://localhost:8000/api/admin/products`) or a metadata endpoint (`http://169.254.169.254/latest/meta-data/`) and have the LLM pipeline fetch and surface it in the draft response. Admin-only, so risk is bounded.

**Recommendation**

Wrap the field assignment with `assert_public_http_url(body.image_url)` at the top of `draft_listing` (helper already imported elsewhere in the codebase). Same fix for `ApproveRequest.image_url` if the variant's `image_url` is ever fetched server-side (it is currently only stored).

### L-4 — Admin promotion happens via direct DB UPDATE with no audit trail  ·  **Low**  ·  AuthZ / Operations

**Evidence**

`User.is_admin` (`models.py:21`) has no setter endpoint. There is no `admin_actions` log table, no `User.promoted_by`, no `created_by`. The README presumably tells operators to run a SQL `UPDATE users SET is_admin = true WHERE email = ?`.

**Impact**

If admin credentials or DB access are compromised, there is no record of who granted admin to whom. Forensics post-incident is impossible.

**Recommendation**

Add an `admin_audit_log` table (`actor_user_id`, `action`, `target_user_id`, `created_at`, `details JSONB`) and a thin `POST /api/admin/users/{id}/grant-admin` endpoint that writes both the role change and the log row in one transaction. Even if operators continue to run raw SQL, the table can be populated by a DB trigger.

### I-1 — CORS `allow_origin_regex` is anchored correctly  ·  **Info**  ·  Config (positive control)

`main.py:64` uses `r"^https://(frontend|mainstreet)[a-z0-9-]*\.up\.railway\.app$"` — anchored on both sides, scheme-locked to HTTPS, and restricted to a known prefix. Verified safe: an attacker cannot register `frontend.attacker.up.railway.app.evil.com` and pass the check (the trailing `$` blocks that).

### I-2 — `.env*` correctly gitignored; no secret material in tracked files  ·  **Info**  ·  Config (positive control)

`git ls-files` shows only `*.env.example` (template) files tracked. `.gitignore` covers `.env` and `*.env`. The `test-secret-key-do-not-use-in-prod` string in `backend/tests/conftest.py:10` is for tests only and is explicit about it.

### I-3 — No password reset flow exists  ·  **Info**  ·  AuthN

There is no `/api/auth/password-reset`, no email-sending integration, and no `reset_token` column. This is appropriate not to audit (you can't audit code that doesn't exist), but flagged because adding one is a common future change that requires its own threat model: token entropy (≥128 bits, `secrets.token_urlsafe(32)`), single-use, ≤1h expiry, bound to user id and email, rate-limited, and the reset itself bumps `tokens_invalid_after` (see H-1).

---

## 4. Positive Controls (Do Not Regress)

- **Startup secret-length assertion** — `main.py:32-36` refuses to boot if `SECRET_KEY` is <32 chars.
- **`SECRET_KEY` is required**, not defaulted (`config.py:5`, no default value → pydantic raises if missing).
- **Bcrypt via passlib**, default cost (~12) — `auth.py:13`. Password verification is constant-time within bcrypt.
- **12-char minimum password length**, enforced server-side in `UserRegister.password_min_length` (`schemas.py:14-19`).
- **Generic error messages on register and login** — no email-existence disclosure (`auth.py:23, 43`).
- **slowapi rate limiting on register (5/min) and login (10/min)** — `routers/auth.py:17, 38`. (See M-2 for the proxy caveat.)
- **JWT algorithm is pinned** as a list — `jwt.decode(..., algorithms=[settings.algorithm])` in both `get_current_user:37` and `get_optional_user:60`. No `alg: none` confusion possible.
- **Authorization role is re-fetched from DB on every request** (`auth.py:44`), so a stolen-but-not-yet-promoted token cannot escalate by mutating `is_admin` in a re-signed payload (no admin claim is even in the token).
- **All admin routes resolve `get_admin_user`** as a dependency — verified by inspecting every route in `routers/admin.py` and `routers/listing_agent.py`. No admin route uses `get_current_user` only.
- **Per-resource ownership filters on every authenticated read/write** for cart (`cart.py:36-39`, `_owner_filter` used at every site), agent sessions (`agent.py:79-80, 106, 162, 191-194`), inbox (`inbox.py:18-19, 33-36, 54-57`), mason memory (all queries scope by `current_user.id`).
- **Cart `AddItemIn` schema rejects wire-supplied `session_id`** — regression-tested in `test_security.py:64-71`.
- **Mass-assignment guard for `is_admin`** — regression-tested in `test_security.py:14-25`.
- **SSRF guard with broad private-range coverage** — `agent/upload_safety.py:70-107` checks `is_private`, `is_loopback`, `is_link_local`, `is_multicast`, `is_reserved`, `is_unspecified` across all address families; regression-tested for IMDS, loopback, RFC1918, file://, ftp://, javascript:.
- **Image upload magic-byte sniff rejects SVG** — `agent/upload_safety.py:43-64`, regression-tested.
- **Stripe webhook signature verification is real** — `cart.py:441` uses `stripe.Webhook.construct_event`, raw body is passed (`payload = await request.body()`, line 438), and the secret is loaded from env (`config.py:23`).
- **CSV formula-injection defused on export** — `admin.py:355-363` prefixes `=`, `+`, `-`, `@`, `\t`, `\r`.
- **SQL queries are parameterized** — all `text(...)` uses bind parameters (`products.py:78`, `bindparams(tag_arr=tags)`), and user input never reaches a raw SQL string.
- **CORS regex anchored** — `main.py:64`, no `allow_origins=["*"]` with `allow_credentials=True`.
- **Cart partial unique indexes** prevent duplicate user/variant rows at the DB level (`models.py:258-271`).
- **Agent session ownership for guests is `user_id IS NULL`-strict** — an authenticated user cannot post into a guest session and vice versa (`agent.py:184-196`).
- **Frontend has no `dangerouslySetInnerHTML` or `innerHTML=` and no markdown renderer** — verified via grep.

---

## 5. Appendix — Endpoint Inventory

| Method | Path | Auth | AuthZ check | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | public | n/a | 5/min limit; 12-char min password |
| POST | `/api/auth/login` | public | n/a | 10/min limit; generic error |
| GET | `/api/auth/me` | user | self | — |
| GET | `/api/shops/public` | public | n/a | id+name only |
| GET | `/api/shops/public/full` | public | n/a | id, name, logo, desc, website, count |
| GET | `/api/shops` | user | none beyond auth | Tenant-wide visibility |
| GET | `/api/shops/{id}` | user | none beyond auth | — |
| GET | `/api/products` | user | none beyond auth | Search |
| GET | `/api/products/discover` | public | n/a | Inconsistent with `/api/products`; review whether `/discover` leaks any field the search-protected variant intends to hide |
| GET | `/api/products/discover/count` | public | n/a | — |
| GET | `/api/products/tags` | public | n/a | — |
| GET | `/api/products/{id}` | user | none beyond auth | — |
| GET | `/api/cart` | user | `user.id` | Via `_owner_filter` |
| POST | `/api/cart/items` | user | `user.id` | Schema rejects wire `session_id` |
| PATCH | `/api/cart/items/{variant_id}` | user | `user.id` | — |
| DELETE | `/api/cart/items/{variant_id}` | user | `user.id` | — |
| POST | `/api/cart/checkout` | user | `user.id` | Stripe session creation; consider rate limit |
| POST | `/api/cart/webhook` | public | Stripe signature | No `event["id"]` dedupe (M-4) |
| GET | `/api/agent/suggestions` | user | self | — |
| GET | `/api/agent/sessions` | user | `user.id` | — |
| POST | `/api/agent/sessions` | user | `user.id` | — |
| POST | `/api/agent/guest-session` | public | session marked guest | `user_id` forced to NULL |
| DELETE | `/api/agent/sessions/{id}` | user | `user.id` | — |
| GET | `/api/agent/sessions/{id}/turns` | user | `user.id` | Limit clamped 1..100 |
| GET | `/api/agent/sessions/{id}/plan` | user | `user.id` | — |
| POST | `/api/agent/turn` | optional | guest paths match `user_id IS NULL`; auth paths match `user.id` | — |
| GET | `/api/inbox` | user | `user.id` | — |
| PATCH | `/api/inbox/{id}/read` | user | `user.id` | — |
| POST | `/api/inbox/{id}/open` | user | `user.id` | Writes `msg.body` into agent turn (M-6) |
| GET/POST/DELETE | `/api/mason/notes[...]` | user | `user.id` | — |
| GET/PATCH | `/api/mason/prefs` | user | `user.id` | — |
| GET/PATCH | `/api/mason/shipping` | user | `user.id` | — |
| GET/POST/DELETE | `/api/mason/saved-products[...]` | user | `user.id` | — |
| POST | `/api/admin/shops/upload-logo` | admin | `is_admin` | Capped + magic-byte validated |
| POST | `/api/admin/import` | admin | `is_admin` | Capped (10 MB) |
| POST | `/api/admin/import/shops` | admin | `is_admin` | **Uncapped (M-1)** |
| GET | `/api/admin/export/products` | admin | `is_admin` | CSV-safe |
| GET | `/api/admin/export/shops` | admin | `is_admin` | CSV-safe |
| GET/POST/DELETE | `/api/admin/shops[...]` | admin | `is_admin` | No per-shop scoping (multi-tenant note) |
| GET/DELETE | `/api/admin/products[...]` | admin | `is_admin` | DELETE-all clears every product |
| POST | `/api/admin/listing/upload-image` | admin | `is_admin` | Capped + magic-byte validated |
| POST | `/api/admin/listing/draft` | admin | `is_admin` | `image_url` not SSRF-checked at boundary (L-3); consider rate-limit (LLM cost) |
| POST | `/api/admin/listing/approve` | admin | `is_admin` | — |
| GET | `/api/health` | public | n/a | — |
