"""Per-million-token pricing for Claude models, and a cost helper.

Rates are USD per 1M tokens. Keep aligned with Anthropic's public pricing.
Unknown models return 0.0 cost so telemetry never breaks the request path.
"""
from __future__ import annotations

PRICING: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {
        "input": 3.0,
        "output": 15.0,
        "cache_write": 3.75,
        "cache_read": 0.30,
    },
    "claude-haiku-4-5-20251001": {
        "input": 1.0,
        "output": 5.0,
        "cache_write": 1.25,
        "cache_read": 0.10,
    },
}


def compute_cost(
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    p = PRICING.get(model)
    if not p:
        return 0.0
    return (
        input_tokens * p["input"]
        + output_tokens * p["output"]
        + cache_read_tokens * p["cache_read"]
        + cache_creation_tokens * p["cache_write"]
    ) / 1_000_000
