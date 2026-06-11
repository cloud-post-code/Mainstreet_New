import posthog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from posthog import capture, identify_context, new_context
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import get_db
from db.models import User
from db.schemas import UserRegister, UserLogin, UserOut, Token
from auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Global defaults apply to every route on the app unless overridden by a
# per-route @limiter.limit(...) decorator or marked @limiter.exempt.
# Keyed by client IP (works for anonymous users; fine while traffic is small).
#
# TODO: storage is in-memory per worker. When this service scales past one
# Uvicorn worker, pass `storage_uri="redis://..."` so counters are shared.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["300/minute", "5000/hour"],
)


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, body: UserRegister, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalars().first():
        # Generic message — don't confirm to the client whether the address
        # already exists. (Email enumeration defense.)
        raise HTTPException(status_code=400, detail="Registration failed")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name or body.email.split("@")[0],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    with new_context():
        identify_context(str(user.id))
        posthog.set(str(user.id), {"display_name": user.display_name})
        capture("user_registered", properties={"signup_method": "form"})

    return Token(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
async def login(request: Request, body: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalars().first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    with new_context():
        identify_context(str(user.id))
        capture("user_logged_in", properties={"login_method": "password"})

    return Token(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
