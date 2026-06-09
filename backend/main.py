import asyncio
import logging
from contextlib import asynccontextmanager

from datetime import datetime, timezone

from fastapi import FastAPI, Request
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
from agent.uploads import upload_root
from routers import auth, shops, products, agent, admin, inbox, listing_agent, cart, mason_memory

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
    yield


app = FastAPI(title="Personal Shopper API", version="1.0.0", lifespan=lifespan)

# Rate-limit exceeded → 429. The Limiter instance lives in routers.auth and is
# referenced via decorators; this just registers the handler at the app level.
app.state.limiter = auth.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# Enforce the limiter's default_limits across every route (not just decorated ones).
app.add_middleware(SlowAPIMiddleware)
# Railway terminates TLS at its proxy, so the client IP arrives in
# X-Forwarded-For. Without this, get_remote_address returns the proxy's
# internal IP for every request and the limiter buckets all traffic together.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

# Allow multiple frontend origins via comma-separated FRONTEND_URL, plus
# localhost dev and any *.up.railway.app preview/production URL. The regex
# catches Railway-managed domain changes without requiring an env var update.
_explicit_origins = [
    o.strip()
    for o in settings.frontend_url.split(",")
    if o.strip()
] + ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_explicit_origins,
    # Only match this project's Railway-managed subdomains (frontend-*), not every
    # tenant on *.up.railway.app. Adjust the prefix list if new Railway services
    # are added to this project.
    allow_origin_regex=r"^https://(frontend|mainstreet)[a-z0-9-]*\.up\.railway\.app$",
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

app.mount("/uploads", StaticFiles(directory=str(upload_root())), name="uploads")


@app.get("/api/health")
@auth.limiter.exempt
async def health(request: Request):
    return {"status": "ok"}
