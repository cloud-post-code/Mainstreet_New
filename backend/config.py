from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "change-me-in-production-use-a-long-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    anthropic_api_key: str = ""
    frontend_url: str = "http://localhost:5173"

    # Railway object storage (S3-compatible) for product image uploads
    railway_bucket_name: str = ""
    railway_bucket_endpoint: str = ""
    railway_bucket_access_key: str = ""
    railway_bucket_secret_key: str = ""
    railway_bucket_region: str = "us-east-1"
    railway_bucket_public_base_url: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
