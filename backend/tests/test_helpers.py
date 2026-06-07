"""Does this convert input into output?

Tests for utility helpers: query normalization, LRU cache, canonical text,
reciprocal rank fusion, vector literal formatting.
"""
from agent.embeddings import (
    _REWRITE_LRU_MAX,
    _normalize_query,
    _rewrite_lru,
    _rewrite_lru_get,
    _rewrite_lru_put,
    build_canonical_text,
    reciprocal_rank_fusion,
    vector_literal,
)


# ── _normalize_query ─────────────────────────────────────────────────────────

def test_normalize_query_lowercases():
    assert _normalize_query("HELLO World") == "hello world"


def test_normalize_query_collapses_whitespace():
    assert _normalize_query("a   b\t\tc\n\nd") == "a b c d"


def test_normalize_query_strips_edges():
    assert _normalize_query("  hi  ") == "hi"


def test_normalize_query_empty():
    assert _normalize_query("") == ""


def test_normalize_query_none_safe():
    assert _normalize_query(None) == ""  # type: ignore[arg-type]


# ── LRU cache ────────────────────────────────────────────────────────────────

def _reset_lru():
    _rewrite_lru.clear()


def test_lru_get_miss_returns_none():
    _reset_lru()
    assert _rewrite_lru_get("missing") is None


def test_lru_put_then_get():
    _reset_lru()
    _rewrite_lru_put("k", ["a", "b"])
    assert _rewrite_lru_get("k") == ("a", "b")


def test_lru_move_to_end_on_hit():
    _reset_lru()
    _rewrite_lru_put("a", ["1"])
    _rewrite_lru_put("b", ["2"])
    _rewrite_lru_put("c", ["3"])
    # Touch 'a' so it becomes most recent.
    _rewrite_lru_get("a")
    order = list(_rewrite_lru.keys())
    assert order[-1] == "a"


def test_lru_evicts_oldest_when_over_max():
    _reset_lru()
    # Fill to max + 5; oldest 5 should be evicted.
    for i in range(_REWRITE_LRU_MAX + 5):
        _rewrite_lru_put(f"k{i}", [str(i)])
    assert len(_rewrite_lru) == _REWRITE_LRU_MAX
    # Oldest keys evicted.
    assert "k0" not in _rewrite_lru
    assert f"k{_REWRITE_LRU_MAX + 4}" in _rewrite_lru


# ── build_canonical_text ─────────────────────────────────────────────────────

def test_canonical_text_joins_fields_with_separator():
    out = build_canonical_text(
        name="Wool Hat",
        shop_name="Acme",
        description={"summary": "A warm hat", "tags": ["wool", "winter"], "long": "Long desc"},
    )
    assert "Wool Hat" in out
    assert "Acme" in out
    assert "A warm hat" in out
    assert "wool winter" in out
    assert "Long desc" in out
    assert " | " in out


def test_canonical_text_skips_empty_parts():
    out = build_canonical_text(name="X", shop_name=None, description=None)
    assert out == "X"


def test_canonical_text_tags_non_list_coerced():
    out = build_canonical_text(name="X", shop_name=None, description={"tags": "single-tag"})
    assert "single-tag" in out


# ── reciprocal_rank_fusion ───────────────────────────────────────────────────

def test_rrf_single_list_preserves_order():
    out = reciprocal_rank_fusion([[1, 2, 3]])
    assert [pid for pid, _ in out] == [1, 2, 3]


def test_rrf_fuses_two_lists():
    # ID 5 appears in both lists; should rank above singletons.
    out = reciprocal_rank_fusion([[5, 1, 2], [5, 3, 4]])
    ranked_ids = [pid for pid, _ in out]
    assert ranked_ids[0] == 5


def test_rrf_empty_returns_empty():
    assert reciprocal_rank_fusion([]) == []


# ── vector_literal ──────────────────────────────────────────────────────────

def test_vector_literal_format():
    out = vector_literal([0.1, 0.2, 0.3])
    assert out.startswith("[") and out.endswith("]")
    parts = out[1:-1].split(",")
    assert len(parts) == 3
    # 7-decimal precision.
    assert parts[0] == "0.1000000"


def test_vector_literal_empty():
    assert vector_literal([]) == "[]"
