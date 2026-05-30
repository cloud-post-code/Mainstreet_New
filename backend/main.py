from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from db.database import create_tables
from routers import auth, shops, products, agent, admin, inbox


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    import os
    if os.environ.get("SEED_ON_STARTUP", "").lower() in ("1", "true", "yes"):
        from db.seed import seed
        await seed()
    yield


app = FastAPI(title="Personal Shopper API", version="1.0.0", lifespan=lifespan)

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
    allow_origin_regex=r"https://.*\.up\.railway\.app",
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
