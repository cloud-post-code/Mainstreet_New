"""Security regression tests."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.schemas import UserRegister  # noqa: E402


def test_register_payload_ignores_is_admin():
    """Defense against mass assignment: the registration schema must not accept
    is_admin even if a client sends it. UserRegister has no is_admin field,
    so Pydantic's `extra = "ignore"` (default) drops it. This test guards against
    a future refactor that loosens the schema."""
    body = UserRegister(
        email="someone@example.com",
        password="hunter2hunter2",
        display_name="x",
        is_admin=True,  # type: ignore[call-arg]
    )
    assert not hasattr(body, "is_admin")
