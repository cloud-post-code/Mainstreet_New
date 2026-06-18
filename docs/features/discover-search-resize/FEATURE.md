# Feature: Resize Discover Search Bar to Normal Width

The search input on the Discover page is currently oversized. Resize it to a standard, proportional width that feels like a normal search bar.

## Acceptance Scenarios

```gherkin
Feature: Discover search bar sizing

  Scenario: Search bar is a normal proportional width on desktop
    Given I am on the Discover page on a desktop viewport (≥1024px)
    Then the search input is centered and no wider than 480px
    And it does not span the full page width

  Scenario: Search bar is full width on mobile
    Given I am on the Discover page on a mobile viewport (<640px)
    Then the search input spans the full available width

  Scenario: Search functionality is unchanged
    Given the search bar has been resized
    When I type a search query
    Then products filter correctly as before
```

## Constraints
- CSS/Tailwind change only — no logic changes.
- Max width on desktop: 480px, centered.
- The search bar container and any wrapping element must be adjusted consistently.

## Implementation Routing
- Frontend: `frontend/src/pages/Discover.tsx` — search input wrapper classes
