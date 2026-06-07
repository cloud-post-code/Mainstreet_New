"""Helpers for parsing comma-separated query parameters."""


def parse_comma_int_list(value: str | None) -> list[int]:
    """Parse "1,2,3" → [1, 2, 3]. Skips non-numeric entries."""
    if not value:
        return []
    return [int(tok) for tok in value.split(",") if tok.strip().isdigit()]


def parse_comma_str_list(value: str | None) -> list[str]:
    """Parse "a, b ,c" → ["a", "b", "c"]. Skips empty entries."""
    if not value:
        return []
    return [tok.strip() for tok in value.split(",") if tok.strip()]
