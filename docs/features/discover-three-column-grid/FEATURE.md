# Feature: Discover Page — 3-Column Product Grid

## Goal
Display Discover page products in a strict 3-column grid (matching the screenshot provided by user on 2026-06-18), replacing the current responsive auto-fit layout that varies between 2–4 columns depending on viewport width.

## Context
The user shared a screenshot of a 3-across layout (blue shirt / green Pinewood tee / jeans) and wants this to be the standard Discover grid. The layout should show products in clean, equal-width columns with consistent card heights.

## Acceptance Scenarios

1. **3-column grid on desktop**: At ≥ 900px viewport, Discover shows exactly 3 product columns per row.
2. **Responsive fallback**: At < 640px, grid collapses to 1 column. At 640–899px, 2 columns.
3. **Equal card heights per row**: All cards in the same grid row are the same height (stretch alignment).
4. **Cards fill height gracefully**: Non-variant cards use description text to fill vertical space rather than leaving empty whitespace (already addressed by the `.productCardGrid .productDesc` flex fix).
5. **No horizontal scroll**: The grid never overflows its container.
6. **Pagination unchanged**: Infinite scroll / load-more behavior is unaffected.

## Implementation Notes

- `frontend/src/pages/Discover.tsx` renders the product grid — currently likely uses an auto-fit CSS grid.
- Change the grid container to `grid-template-columns: repeat(3, 1fr)` with responsive breakpoints.
- Cards already use `layout="grid"` (`productCardGrid` class) so height/image aspect ratio is already correct.
- This is a CSS-only change in `Discover.module.css` (and possibly a small tweak in `Discover.tsx` if columns are set inline).
