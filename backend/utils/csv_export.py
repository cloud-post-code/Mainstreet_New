"""Shared CSV export helpers."""
from fastapi.responses import StreamingResponse


def csv_safe(value) -> str:
    """Defuse CSV-formula injection. Excel/Sheets execute cells starting with
    =, +, -, @, tab, or CR as formulas. Prefix with a single quote when needed."""
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def csv_response(content: str, filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
