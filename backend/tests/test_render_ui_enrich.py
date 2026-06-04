"""Tests for render_ui product_card quantity enrichment."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.a2ui_schema import enrich_render_ui_payload  # noqa: E402


def test_enrich_fills_missing_quantity_on_product_cards():
    payload = {
        "root": "root_1",
        "components": [
            {
                "id": "card_1",
                "type": "product_card",
                "props": {"product_id": 17, "name": "Trailrunner", "price": 89, "shop_name": "SportsPeak"},
            },
            {"id": "text_1", "type": "text_block", "props": {"content": "Hello"}},
        ],
    }
    enriched = enrich_render_ui_payload(payload, {17: 3, 99: 0})
    card = next(c for c in enriched["components"] if c["id"] == "card_1")
    assert card["props"]["quantity"] == 3


def test_enrich_overwrites_stale_quantity():
    payload = {
        "root": "root_1",
        "components": [
            {
                "id": "card_1",
                "type": "product_card",
                "props": {
                    "product_id": 17,
                    "name": "Trailrunner",
                    "price": 89,
                    "shop_name": "SportsPeak",
                    "quantity": 0,
                },
            },
        ],
    }
    enriched = enrich_render_ui_payload(payload, {17: 5})
    card = enriched["components"][0]
    assert card["props"]["quantity"] == 5
