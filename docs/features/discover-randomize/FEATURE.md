# Feature: Randomize Discover Product Order on Each Load

The Discover page currently shows products in the same ranked order every visit. Introduce a random seed or shuffle so the product grid feels fresh and different each time.

## Acceptance Scenarios

```gherkin
Feature: Discover page randomized product order

  Scenario: Product order is different between page loads
    Given I load the Discover page with no search query
    And I note the order of the first 10 products
    When I reload the page
    Then the order of those products is different (shuffled)

  Scenario: Randomization applies to the first page of results
    Given I load Discover with no filters
    Then the first 24 products are in a randomized order each time

  Scenario: Search results are not randomized
    Given I have typed a search query
    Then products are ordered by relevance (not randomized)
    And the random seed has no effect on search results

  Scenario: Filter-only browsing is still randomized
    Given I have selected a shop or tag filter but no search text
    Then the results are still randomized on each load
```

## Constraints
- Randomization applies only when there is no active search query (`q` is empty or absent).
- Implementation: pass a random `seed` integer from the frontend on each page load; backend uses it in an `ORDER BY random()` or equivalent when no search query is present.
- The seed is generated once per page mount (not per scroll page) so infinite scroll within a session stays consistent.
- Do not randomize when `q` is set — keep relevance ranking for search.

## Implementation Routing
- Backend: `backend/routers/products.py` — `GET /api/products/discover` — add `seed` param, apply `ORDER BY` when no query
- Frontend: `frontend/src/pages/Discover.tsx` — generate seed on mount, pass to API calls
