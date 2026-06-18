# Feature: Fix Board Grid Images — Normal Proportional Size

Board grid product images are currently too large. Resize them so the grid looks proportional and browseable — similar to a standard Pinterest-style image grid.

## Acceptance Scenarios

```gherkin
Feature: Board grid image sizing

  Scenario: Board product images are a normal browseable size
    Given I am viewing a board with saved products
    Then the product image tiles are smaller and more grid-like
    And I can see multiple products at once without scrolling

  Scenario: Images maintain aspect ratio and fill their tile
    Given a board product tile
    Then the image fills the tile with object-fit cover
    And the tile has a square or near-square aspect ratio

  Scenario: Grid layout shows at least 3 columns on desktop
    Given I am on a desktop viewport (≥1024px)
    Then the board product grid shows at least 3 columns
```

## Constraints
- Change tile size in `Boards.module.css` (`.savedTile`, `.savedGrid`).
- Move from 2-column to 3-column grid on desktop.
- Keep the 1:1 aspect ratio and `object-fit: cover`.
- Reduce gap slightly if needed (e.g. 6px) to keep things tight.
- No logic changes — CSS only.

## Implementation Routing
- Frontend: CSS file for Boards — `.savedGrid` and `.savedTile` rules
