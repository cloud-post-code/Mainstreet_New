from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from config import settings
from db.database import create_tables
from agent.uploads import upload_root
from routers import auth, shops, products, agent, admin, inbox, listing_agent, cart


@asynccontextmanager
async def lifespan(app: FastAPI):
    if len(settings.secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY must be set to a 32+ character random value. "
            "Generate with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    upload_root().mkdir(parents=True, exist_ok=True)
    await create_tables()
    yield


app = FastAPI(title="Personal Shopper API", version="1.0.0", lifespan=lifespan)

# Rate-limit exceeded → 429. The Limiter instance lives in routers.auth and is
# referenced via decorators; this just registers the handler at the app level.
app.state.limiter = auth.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
)

app.include_router(auth.router)
app.include_router(shops.router)
app.include_router(products.router)
app.include_router(agent.router)
app.include_router(admin.router)
app.include_router(inbox.router)
app.include_router(listing_agent.router)
app.include_router(cart.router)

app.mount("/uploads", StaticFiles(directory=str(upload_root())), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
