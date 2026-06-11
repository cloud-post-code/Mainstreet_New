"""PostHog ASGI middleware — wraps each HTTP request in a PostHog context.

Decodes the Bearer JWT (if present) so that route handlers can call
posthog.capture() without needing to supply a distinct_id manually.
"""

from typing import Optional

from jose import JWTError, jwt
from posthog import identify_context, new_context

from config import settings


class PostHogMiddleware:
    """Pure ASGI middleware that wraps each request in a PostHog context."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or settings.posthog_disabled:
            await self.app(scope, receive, send)
            return

        user_id = self._user_id_from_scope(scope)

        with new_context():
            if user_id:
                identify_context(user_id)
            await self.app(scope, receive, send)

    def _user_id_from_scope(self, scope) -> Optional[str]:
        headers = dict(scope.get("headers", []))
        auth = headers.get(b"authorization", b"").decode("utf-8")
        if not auth.startswith("Bearer "):
            return None
        token = auth.split(" ", 1)[1]
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
            return payload.get("sub")
        except (JWTError, Exception):
            return None
