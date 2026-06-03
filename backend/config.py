from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    frontend_url: str = "http://localhost:5173"

    # Product images: saved under upload_dir, served at /uploads, URL stored in Product.image_url
    upload_dir: str = "uploads"
    # Set on Railway to your backend public URL (e.g. https://your-api.up.railway.app)
    public_api_url: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
