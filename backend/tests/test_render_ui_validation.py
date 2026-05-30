"""Tests for the A2UI render_ui payload validator."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.a2ui_schema import validate_render_ui  # noqa: E402


def _valid_minimal_payload():
    return {
        "root": "r1",
        "components": [
            {
                "id": "r1",
                "type": "stack",
                "props": {},
                "children": ["t1"],
            },
            {
                "id": "t1",
                "type": "text_block",
                "props": {"content": "Hello"},
            },
        ],
    }


def test_valid_minimal_payload():
    assert validate_render_ui(_valid_minimal_payload()) == []


def test_valid_full_payload():
    payload = {
        "root": "root_1",
        "components": [
            {"id": "root_1", "type": "stack", "props": {}, "children": ["grid_1", "text_1", "reason_1"]},
            {
                "id": "grid_1",
                "type": "product_grid",
                "props": {"layout": "recommendation", "title": "Top picks"},
                "children": ["card_1"],
            },
            {
                "id": "card_1",
                "type": "product_card",
                "props": {"product_id": 1, "name": "X", "price": 10.0, "shop_name": "S"},
            },
            {"id": "text_1", "type": "text_block", "props": {"content": "Explanation"}},
            {"id": "reason_1", "type": "reasoning_block", "props": {"summary": "Why."}},
        ],
    }
    assert validate_render_ui(payload) == []


def test_missing_root():
    payload = _valid_minimal_payload()
    del payload["root"]
    errors = validate_render_ui(payload)
    assert any("root" in e for e in errors)


def test_root_not_in_components():
    payload = _valid_minimal_payload()
    payload["root"] = "ghost"
    errors = validate_render_ui(payload)
    assert any("ghost" in e for e in errors)


def test_unknown_type():
    payload = _valid_minimal_payload()
    payload["components"][1]["type"] = "magic_card"
    errors = validate_render_ui(payload)
    assert any("magic_card" in e for e in errors)


def test_missing_required_prop():
    payload = _valid_minimal_payload()
    payload["components"][1]["props"] = {}  # text_block requires `content`
    errors = validate_render_ui(payload)
    assert any("content" in e for e in errors)


def test_dangling_child_ref():
    payload = {
        "root": "r1",
        "components": [
            {"id": "r1", "type": "stack", "props": {}, "children": ["ghost"]},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("ghost" in e for e in errors)


def test_cycle():
    payload = {
        "root": "a",
        "components": [
            {"id": "a", "type": "stack", "props": {}, "children": ["b"]},
            {"id": "b", "type": "stack", "props": {}, "children": ["a"]},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("cycle" in e.lower() for e in errors)


def test_invalid_grid_layout():
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["g", "t"]},
            {"id": "g", "type": "product_grid", "props": {"layout": "wonky", "title": "T"}, "children": []},
            {"id": "t", "type": "text_block", "props": {"content": "x"}},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("wonky" in e for e in errors)


def test_leaf_with_children_rejected():
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["t"]},
            {"id": "t", "type": "text_block", "props": {"content": "x"}, "children": ["t"]},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("cannot have children" in e for e in errors)


def test_orphan_component():
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["t"]},
            {"id": "t", "type": "text_block", "props": {"content": "x"}},
            {"id": "orphan", "type": "text_block", "props": {"content": "lonely"}},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("unreachable" in e.lower() for e in errors)


def test_comparison_table_valid():
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["ct", "t"]},
            {
                "id": "ct",
                "type": "comparison_table",
                "props": {
                    "product_ids": [1, 2],
                    "products": [
                        {"product_id": 1, "name": "A", "price": 10},
                        {"product_id": 2, "name": "B", "price": 20},
                    ],
                    "attributes": ["price"],
                },
            },
            {"id": "t", "type": "text_block", "props": {"content": "x"}},
        ],
    }
    assert validate_render_ui(payload) == []


def test_comparison_table_missing_required_props():
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["ct", "t"]},
            {"id": "ct", "type": "comparison_table", "props": {"product_ids": [1]}},
            {"id": "t", "type": "text_block", "props": {"content": "x"}},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("products" in e for e in errors), errors
    assert any("attributes" in e for e in errors), errors


def test_comparison_table_product_ids_missing_from_products():
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["ct", "t"]},
            {
                "id": "ct",
                "type": "comparison_table",
                "props": {
                    "product_ids": [1, 2, 99],
                    "products": [
                        {"product_id": 1, "name": "A"},
                        {"product_id": 2, "name": "B"},
                    ],
                    "attributes": ["price"],
                },
            },
            {"id": "t", "type": "text_block", "props": {"content": "x"}},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("99" in e for e in errors), errors


def test_cycle_and_missing_prop_both_reported():
    """Regression: prop errors used to suppress cycle detection."""
    payload = {
        "root": "a",
        "components": [
            {"id": "a", "type": "stack", "props": {}, "children": ["b"]},
            {"id": "b", "type": "stack", "props": {}, "children": ["t", "a"]},
            {"id": "t", "type": "text_block", "props": {}},  # missing content
        ],
    }
    errors = validate_render_ui(payload)
    assert any("content" in e for e in errors), errors
    assert any("cycle" in e.lower() for e in errors), errors


def test_orphan_and_missing_prop_both_reported():
    """Regression: prop errors used to suppress orphan detection."""
    payload = {
        "root": "r",
        "components": [
            {"id": "r", "type": "stack", "props": {}, "children": ["t"]},
            {"id": "t", "type": "text_block", "props": {}},  # missing content
            {"id": "orphan", "type": "text_block", "props": {"content": "lonely"}},
        ],
    }
    errors = validate_render_ui(payload)
    assert any("content" in e for e in errors), errors
    assert any("unreachable" in e.lower() for e in errors), errors


