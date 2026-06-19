# Feature: Home Page (Chat) UI Redesign

The Chat page empty state and overall layout is boxy and awkwardly placed. Redesign it to feel clean, spacious, and modern — closer to ChatGPT's home screen: centered greeting, soft suggestion chips, and an input bar that feels anchored and intentional.

## Acceptance Scenarios

```gherkin
Feature: Home page UI redesign

  Scenario: Empty state is centered and airy
    Given I open the Chat page with no messages
    Then the Mason avatar, greeting, and suggestion chips are vertically centered
    And there is generous whitespace above and below the greeting
    And nothing feels crammed or boxy

  Scenario: Greeting and tagline are legible and on-brand
    Given I am on the empty Chat page
    Then I see a warm greeting line using Mason's voice
    And a short tagline beneath it
    And both use the brand fonts (Playfair Display / Lora)

  Scenario: Suggestion chips look clickable and consistent
    Given the empty state is showing
    Then suggestion chips are displayed in a row (or two rows on mobile)
    And each chip has consistent padding, border-radius, and hover state
    And clicking a chip sends that text as a message

  Scenario: Input bar feels anchored
    Given I am on the Chat page
    Then the input bar is visually distinct at the bottom
    And the textarea has a clean border with a subtle shadow
    And the send button is clearly visible
```

## Constraints
- Changes to `Chat.tsx` empty state JSX and `Chat.module.css`.
- Keep all existing logic (mode dropdown, send, streaming) unchanged.
- The background pattern can stay but soften it or reduce opacity if it adds clutter.
- Suggestion chips should wrap gracefully on small screens.
- Do not change the transcript area styling — only the empty state and input bar.

## Implementation Routing
- Frontend: `frontend/src/pages/Chat.tsx` (empty state section), `frontend/src/pages/Chat.module.css`
