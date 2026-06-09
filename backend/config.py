from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str
    algorithm: str = "HS256"
    # 7 days. Tokens are sliding-refreshed on each authenticated request
    # (see middleware in main.py), so active users stay signed in and only
    # 7-days-idle users are forced back to login.
    # Long-term plan: migrate to httpOnly cookies + refresh-token rotation.
    access_token_expire_minutes: int = 60 * 24 * 7
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    frontend_url: str = "http://localhost:5173"

    # Product images: saved under upload_dir, served at /uploads, URL stored in Product.image_url
    upload_dir: str = "uploads"
    # Set on Railway to your backend public URL (e.g. https://your-api.up.railway.app)
    public_api_url: str = ""

    # Stripe Checkout
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_success_url: str = ""
    stripe_cancel_url: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
