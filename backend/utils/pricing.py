"""Money math helpers — keeps rounding behavior consistent across cart, checkout,
and any future pricing surfaces."""
from decimal import Decimal


def format_price(value) -> float:
    """Coerce a price (Decimal | str | int | float | None) to a float rounded
    to 2 decimals. Treats None / non-numeric as 0.0."""
    if value is None:
        return 0.0
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


def line_total(unit_price, qty: int) -> float:
    """Compute `unit_price * qty` rounded to 2 decimals."""
    return round(float(unit_price or 0) * int(qty or 0), 2)


def to_stripe_amount(value) -> int:
    """Convert a price into Stripe's integer-cents amount."""
    if isinstance(value, Decimal):
        cents = (value * 100).quantize(Decimal("1"))
        return int(cents)
    return int(round(float(value or 0) * 100))
