"""Stream Claude responses and surface thinking / text deltas."""
from __future__ import annotations

from typing import Any, Generator, Literal, Optional

import anthropic

StreamChunkKind = Literal["thinking", "text", "done"]

THINKING_CONFIG: dict[str, Any] = {"type": "enabled", "budget_tokens": 10240}


def stream_claude(
    client: anthropic.Anthropic,
    *,
    enable_thinking: bool = True,
    **kwargs: Any,
) -> Generator[tuple[StreamChunkKind, Any], None, None]:
    """
    Yield ('thinking', chunk) and ('text', chunk) as they arrive, then
    ('done', final Message).
    """
    if enable_thinking and "thinking" not in kwargs:
        kwargs["thinking"] = THINKING_CONFIG

    with client.messages.stream(**kwargs) as stream:
        for event in stream:
            if event.type != "content_block_delta":
                continue
            delta = event.delta
            dtype = getattr(delta, "type", None)
            if dtype == "thinking_delta":
                chunk = getattr(delta, "thinking", "") or ""
                if chunk:
                    yield ("thinking", chunk)
            elif dtype == "text_delta":
                chunk = getattr(delta, "text", "") or ""
                if chunk:
                    yield ("text", chunk)
        yield ("done", stream.get_final_message())
