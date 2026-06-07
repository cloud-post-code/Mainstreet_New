"""Shared test fixtures and environment setup.

Sets dummy env vars before any backend module imports, so config.Settings()
doesn't crash when the tests run outside a real deployment.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "test-secret-key-do-not-use-in-prod")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
