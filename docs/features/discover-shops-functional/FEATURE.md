# Feature: Functional Shop Cards on Discover

The "Shop by shop" tab on Discover should show all shops with a real product image as the shop logo fallback when no logo_url is set. Clicking a shop card filters the product grid to that shop's products.

## Acceptance Scenarios

```gherkin
Feature: Discover shops tab

  Scenario: All shops are loaded and displayed
    Given I am on the Discover page
    When I click "Shop by shop"
    Then I see a card for every shop that has at least one product
    And each card shows the shop name and product count

  Scenario: Shop card uses a product image when no logo is set
    Given a shop has no logo_url
    When I view that shop's card
    Then the card displays the first product image from that shop instead of a letter fallback

  Scenario: Clicking a shop card filters the product grid
    Given I am on the Discover page in "Shop by product" mode
    When I click a shop card
    Then the product grid updates to show only products from that shop
    And a filter chip for that shop appears as active
```

## Constraints
- Use the existing `api.getPublicShopsFull()` response — it already returns shops with product counts.
- The backend endpoint `GET /api/shops/public-full` should return `first_product_image_url` per shop (add this if missing).
- The letter fallback (current behavior) is replaced by the product image; if both logo and product image are absent, keep the letter fallback.
- Clicking a shop card should set that shop's ID in the active shop filter, not navigate away.

## Implementation Routing
- Backend: `backend/routers/shops.py` — add `first_product_image_url` to public-full response
- Frontend: `frontend/src/pages/Discover.tsx` — ShopCard component, click handler to set shop filter
