from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from db.database import create_tables
from routers import auth, shops, products, agent, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    import os
    if os.environ.get("SEED_ON_STARTUP", "").lower() in ("1", "true", "yes"):
        from db.seed import seed
        await seed()
    yield


app = FastAPI(title="Personal Shopper API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(shops.router)
app.include_router(products.router)
app.include_router(agent.router)
app.include_router(admin.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
