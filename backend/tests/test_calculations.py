"""Does this calculate something?

Tests for pure calculation functions: pricing, cart totals, cents conversion,
price ranges.
"""
import pytest

from agent.pricing import compute_cost
from routers.cart import _sum_cart_lines


# ── compute_cost ─────────────────────────────────────────────────────────────

def test_compute_cost_zero_tokens():
    assert compute_cost("claude-sonnet-4-6") == 0.0


def test_compute_cost_unknown_model_returns_zero():
    assert compute_cost("nope-model", input_tokens=1_000_000, output_tokens=1_000_000) == 0.0


def test_compute_cost_input_only_sonnet():
    # 1M input tokens at $3.0
    assert compute_cost("claude-sonnet-4-6", input_tokens=1_000_000) == pytest.approx(3.0)


def test_compute_cost_output_only_sonnet():
    assert compute_cost("claude-sonnet-4-6", output_tokens=1_000_000) == pytest.approx(15.0)


def test_compute_cost_haiku_combined():
    cost = compute_cost(
        "claude-haiku-4-5-20251001",
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_read_tokens=1_000_000,
        cache_creation_tokens=1_000_000,
    )
    # 1.0 + 5.0 + 0.10 + 1.25
    assert cost == pytest.approx(7.35)


def test_compute_cost_cache_only():
    cost = compute_cost(
        "claude-sonnet-4-6",
        cache_read_tokens=2_000_000,
        cache_creation_tokens=1_000_000,
    )
    # 2 * 0.30 + 1 * 3.75
    assert cost == pytest.approx(4.35)


def test_compute_cost_fractional_tokens():
    # Small token count keeps the cost tiny but non-zero.
    cost = compute_cost("claude-sonnet-4-6", input_tokens=1000)
    assert cost == pytest.approx(0.003)


# ── _sum_cart_lines ──────────────────────────────────────────────────────────

def test_sum_cart_lines_empty():
    assert _sum_cart_lines([]) == 0.0


def test_sum_cart_lines_single():
    assert _sum_cart_lines([{"subtotal": 9.99}]) == 9.99


def test_sum_cart_lines_multiple():
    lines = [{"subtotal": 1.50}, {"subtotal": 2.50}, {"subtotal": 6.00}]
    assert _sum_cart_lines(lines) == 10.0


def test_sum_cart_lines_handles_floating_point():
    # 0.1 + 0.2 -> 0.30000000000000004 raw; rounded to 0.30
    assert _sum_cart_lines([{"subtotal": 0.1}, {"subtotal": 0.2}]) == 0.30


def test_sum_cart_lines_missing_subtotal_treated_as_zero():
    assert _sum_cart_lines([{"subtotal": 5.0}, {}]) == 5.0


# ── Stripe cents conversion ──────────────────────────────────────────────────

def _to_cents(price: float) -> int:
    """Mirror of cart.checkout()'s line: int(round(float(price) * 100))."""
    return int(round(float(price) * 100))


def test_cents_conversion_simple():
    assert _to_cents(9.99) == 999


def test_cents_conversion_whole_dollar():
    assert _to_cents(10.0) == 1000


def test_cents_conversion_zero():
    assert _to_cents(0) == 0


def test_cents_conversion_large_amount():
    assert _to_cents(12345.67) == 1234567


# ── price range min/max ──────────────────────────────────────────────────────
# Mirrors _hydrate_product_out's PriceRange computation.

from decimal import Decimal


def _price_range(prices):
    if not prices:
        return None
    return (min(prices), max(prices))


def test_price_range_single_variant():
    assert _price_range([Decimal("10.00")]) == (Decimal("10.00"), Decimal("10.00"))


def test_price_range_multiple():
    prices = [Decimal("5.00"), Decimal("10.00"), Decimal("7.50")]
    assert _price_range(prices) == (Decimal("5.00"), Decimal("10.00"))


def test_price_range_empty_is_none():
    assert _price_range([]) is None


def test_price_range_all_same():
    prices = [Decimal("3.00")] * 4
    assert _price_range(prices) == (Decimal("3.00"), Decimal("3.00"))
