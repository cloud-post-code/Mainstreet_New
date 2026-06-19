# Feature: Center the Discover Search Bar

The search bar in the Discover filter bar should be centered, not left-aligned. The filter bar layout needs to stack the search centered above the filter toggle + count row.

## Acceptance Scenarios

```gherkin
Feature: Centered Discover search

  Scenario: Search input is centered on desktop
    Given I am on the Discover page on a desktop viewport
    Then the search input is horizontally centered in the filter bar
    And it does not hug the left edge

  Scenario: Filter toggle and count appear below the search
    Given I am on the Discover page
    Then the Filters button and result count appear on a row below the search input

  Scenario: Search is still full-width on mobile
    Given I am on a mobile viewport (<640px)
    Then the search input spans the full available width

  Scenario: Search functionality unchanged
    When I type a search query
    Then products filter correctly as before
```

## Constraints
- CSS-only change in `Discover.module.css`.
- Restructure `.filterBar` to flex-column with the search centered, then a second row for filters + count.
- Max-width on search stays 480px; it should be centered via `margin: 0 auto`.
- No logic changes.

## Implementation Routing
- Frontend: `frontend/src/pages/Discover.module.css`, `frontend/src/pages/Discover.tsx` (filterBar JSX structure)
