import asyncio
import logging
from contextlib import asynccontextmanager

from datetime import datetime, timezone

import posthog as _posthog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
import auth as _auth_module
from config import settings
from db.database import create_tables
from agent.runner import sweep_zombie_runs
from agent.uploads import upload_root
from posthog_middleware import PostHogMiddleware
from routers import auth, shops, products, agent, admin, inbox, listing_agent, cart, mason_memory, scrapers, pinterest

log = logging.getLogger("uvicorn.error")


async def _run_migrations():
    # Run schema setup in the background so a slow/locked DB doesn't block the
    # port bind and fail Railway's healthcheck. Any error is logged loudly
    # instead of silently hanging the startup.
    try:
        log.info("create_tables: starting")
        await create_tables()
        log.info("create_tables: done")
    except Exception:
        log.exception("create_tables failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if len(settings.secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY must be set to a 32+ character random value. "
            "Generate with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    upload_root().mkdir(parents=True, exist_ok=True)
    asyncio.create_task(_run_migrations())
    # Clear any runs left in 'running' status from a previous process so the
    # per-user concurrency cap isn't permanently exhausted across redeploys.
    asyncio.create_task(sweep_zombie_runs())

    if not settings.posthog_disabled:
        _posthog.api_key = settings.posthog_project_token
        _posthog.host = settings.posthog_host

    yield

    if not settings.posthog_disabled:
        _posthog.flush()


app = FastAPI(title="Personal Shopper API", version="1.0.0", lifespan=lifespan)

# --- CORS config (used both by middleware and error handlers) ---
_explicit_origins = [
    o.strip()
    for o in settings.frontend_url.split(",")
    if o.strip()
] + ["http://localhost:5173"]

_CORS_ORIGIN_REGEX = r"^https://(frontend|mainstreet)[a-z0-9-]*\.up\.railway\.app$"

import re as _re

def _cors_origin(request: Request) -> str | None:
    """Return the request Origin if it's allowed, else None."""
    origin = request.headers.get("origin", "")
    if not origin:
        return None
    if origin in _explicit_origins:
        return origin
    if _re.match(_CORS_ORIGIN_REGEX, origin):
        return origin
    return None

def _cors_headers(request: Request) -> dict:
    origin = _cors_origin(request)
    if not origin:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


def _human_field(loc: list) -> str:
    parts = [str(p) for p in loc if p != "body"]
    return ".".join(parts) if parts else "field"


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return 422 errors as a flat human-readable detail string with CORS headers."""
    messages = []
    for err in exc.errors():
        field = _human_field(list(err.get("loc", [])))
        msg = err.get("msg", "invalid value")
        msg = msg.removeprefix("Value error, ")
        messages.append(f"{field}: {msg}")
    detail = "; ".join(messages) if messages else "Invalid request"
    return JSONResponse(status_code=422, content={"detail": detail}, headers=_cors_headers(request))


from fastapi import HTTPException as _HTTPException
from fastapi.exception_handlers import http_exception_handler as _default_http_handler

@app.exception_handler(_HTTPException)
async def http_exception_cors_handler(request: Request, exc: _HTTPException):
    """Re-use FastAPI's default HTTP exception response but add CORS headers."""
    response = await _default_http_handler(request, exc)
    for k, v in _cors_headers(request).items():
        response.headers[k] = v
    return response


# Rate-limit exceeded → 429.
app.state.limiter = auth.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
# Railway terminates TLS at its proxy — X-Forwarded-For carries the real client IP.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
app.add_middleware(PostHogMiddleware)

# CORSMiddleware is registered last so it is outermost among add_middleware calls.
# The @app.middleware("http") decorator below sits outside even this, so the
# explicit _cors_headers() calls on exception handlers above are needed for
# error responses that bypass the normal response path.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_explicit_origins,
    allow_origin_regex=_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Refreshed-Token"],
)


# Sliding session refresh: when an authenticated request comes in with a token
# that has used up more than 1 day of its life, mint a fresh full-lifetime
# token and return it in X-Refreshed-Token. The frontend persists it so active
# users never get bounced to login while a 7-day-idle user still expires.
_REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60


@app.middleware("http")
async def sliding_token_refresh(request: Request, call_next):
    response = await call_next(request)

    path = request.url.path
    if path.startswith("/api/auth/login") or path.startswith("/api/auth/register"):
        return response

    authorization = request.headers.get("authorization") or request.headers.get("Authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        return response

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return response

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return response

    user_id = payload.get("sub")
    exp = payload.get("exp")
    if not user_id or not exp:
        return response

    full_lifetime = settings.access_token_expire_minutes * 60
    remaining = int(exp) - int(datetime.now(timezone.utc).timestamp())
    if remaining <= 0 or (full_lifetime - remaining) < _REFRESH_THRESHOLD_SECONDS:
        return response

    try:
        new_token = _auth_module.create_access_token(int(user_id))
    except (ValueError, TypeError):
        return response

    response.headers["X-Refreshed-Token"] = new_token
    return response

app.include_router(auth.router)
app.include_router(shops.router)
app.include_router(products.router)
app.include_router(agent.router)
app.include_router(admin.router)
app.include_router(inbox.router)
app.include_router(listing_agent.router)
app.include_router(cart.router)
app.include_router(mason_memory.router)
app.include_router(scrapers.router)
app.include_router(pinterest.router)

app.mount("/uploads", StaticFiles(directory=str(upload_root())), name="uploads")


@app.get("/api/health")
@auth.limiter.exempt
async def health(request: Request):
    return {"status": "ok"}
