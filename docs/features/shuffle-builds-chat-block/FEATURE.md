# Feature: Shuffle Button Builds a Chat Block with 15 Similar Items

When the shuffle button (⇄) is tapped on a product card in the main Chat page, instead of showing an inline panel on the card, it should send a message to Mason who replies with a proper A2UI product grid of 15 similar items plus a short text explanation — appearing as a new message in the chat transcript.

## Acceptance Scenarios

```gherkin
Feature: Shuffle builds a chat block

  Scenario: Tapping shuffle on a chat card sends a message to Mason
    Given Mason has returned a product card in the chat
    When I tap the shuffle (⇄) button on that card
    Then a user message appears in the transcript: "Show me 15 items similar to [product name]"
    And Mason begins replying with a thinking indicator

  Scenario: Mason replies with a product grid + text explanation
    Given I tapped shuffle on a product card
    When Mason's reply arrives
    Then it contains a short text block explaining what was searched
    And a product grid showing up to 15 similar items
    And the grid uses the existing A2UI product_grid component

  Scenario: The product grid in the reply is fully interactive
    Given the shuffle reply is showing
    Then each product card in the grid has add-to-cart and save-to-board buttons
    And clicking a card opens the product detail

  Scenario: Shuffle button is disabled while Mason is replying
    Given I tapped shuffle and Mason is replying
    Then the shuffle button shows a loading state
    And cannot be tapped again until the reply arrives

  Scenario: Shuffle in Discover page still works the old way
    Given I am on the Discover page (not the Chat page)
    When I tap shuffle on a product card
    Then the inline similar-items panel appears as before
    And no chat message is sent
```

## Constraints
- This behavior applies ONLY to product cards in the Chat page (`Chat.tsx`), not Discover.
- The `onShuffle` prop passed to ProductCard from the Chat context should call `sendMessage("Show me 15 items similar to [name]")` instead of fetching inline results.
- The backend already supports semantic search — Mason can handle this query naturally.
- The Renderer.tsx `onShuffle` injection (for chat cards) should be changed to send a chat message via a callback.
- Pass an `onShuffleMessage` callback from Chat.tsx down through the Renderer so it can call `sendMessage`.
- Discover's `onShuffle` (defined inline in Discover.tsx per-card) stays unchanged.

## Implementation Routing
- Frontend: `frontend/src/pages/Chat.tsx` — pass `onShuffleMessage` callback to Renderer
- Frontend: `frontend/src/a2ui/Renderer.tsx` — accept `onShuffleMessage` prop, use it in `onShuffle` for product_card nodes instead of the API call
- Frontend: `frontend/src/a2ui/types.ts` — check if Renderer needs new prop type
