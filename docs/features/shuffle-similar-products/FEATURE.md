# Feature: Shuffle Button on Product Cards Shows 15 Similar Items

Every product card that appears in Mason chat gets a shuffle button. Tapping it runs a semantic similarity search and shows 15 products similar to that item inline.

## Acceptance Scenarios

```gherkin
Feature: Shuffle similar products from chat card

  Scenario: Shuffle button is visible on every chat product card
    Given Mason has returned product cards in the chat
    Then each card has a shuffle icon button
    And the shuffle button is the same size as the save/like button

  Scenario: Tapping shuffle loads 15 similar products
    When I tap the shuffle button on a product card
    Then a loading state appears on that card
    And 15 similar products are fetched via semantic search
    And the results are displayed inline below or replacing the original card

  Scenario: Shuffle results are different from the original product
    Given the shuffle results are displayed
    Then none of the 15 results is the same product as the one I shuffled from

  Scenario: Tapping shuffle again loads a fresh set
    Given shuffle results are already showing
    When I tap the shuffle button again
    Then a new set of 15 similar products is fetched and displayed

  Scenario: Shuffle works on cards in any location
    Given a product card appears anywhere in the chat transcript
    Then the shuffle button is present and functional on that card
```

## Constraints
- The shuffle button icon should use a standard shuffle/refresh icon (e.g. `⇄` or a shuffle SVG), same visual weight as the heart/save button.
- Results come from `GET /api/products/similar?product_id=<id>&limit=15` (new endpoint using existing pgvector cosine similarity).
- Exclude the source product from results.
- The existing per-card shuffle on Discover (which shows 6 items) is separate — do not change it.
- This feature applies specifically to product cards rendered inside the Mason chat transcript.

## Implementation Routing
- Backend: `backend/routers/products.py` — add `GET /api/products/similar` endpoint
- Frontend: `frontend/src/components/ProductCard.tsx` — shuffle button, inline results panel
- Agent: `backend/agent/loop.py` — confirm product cards in chat use ProductCard component with this prop enabled
