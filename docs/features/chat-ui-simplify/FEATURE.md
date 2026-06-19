# Feature: Simplify Chat UI — Cleaner, More Dynamic

The main chat transcript and input bar need to feel simpler and more dynamic. Reference: ChatGPT's clean message bubbles, minimal chrome, and smooth interactions. Remove visual noise, tighten spacing, and make messages feel more conversational.

## Acceptance Scenarios

```gherkin
Feature: Simplified chat UI

  Scenario: User message bubbles are clean and right-aligned
    Given there are messages in the transcript
    Then user messages appear as clean right-aligned bubbles
    And they use a solid brand color background with white text
    And there is no unnecessary border or shadow

  Scenario: Agent message bubbles are minimal and left-aligned
    Given Mason has replied
    Then agent messages appear left-aligned with a light background
    And the Mason avatar is small (28-32px) and sits left of the bubble
    And the bubble has no heavy border

  Scenario: Thinking indicator is subtle
    Given Mason is processing
    Then I see a minimal animated indicator (three dots or similar)
    And it does not take up excessive space

  Scenario: Input bar is clean and full-width
    Given I am in the chat
    Then the input bar spans cleanly across the bottom
    And the textarea grows with content up to a max height
    And there is no visual clutter around the input

  Scenario: Mode dropdown is less prominent
    Given I am looking at the input bar
    Then the mode selector (Auto/Fast/Thinking) is small and unobtrusive
    And it does not dominate the input area

  Scenario: Messages have comfortable but not excessive spacing
    Given a conversation with multiple messages
    Then messages are spaced 12-16px apart
    And there is no large gap between consecutive messages from the same sender
```

## Constraints
- Changes to `Chat.module.css` primarily; minimal changes to `Chat.tsx` JSX structure.
- Do not change any streaming logic, A2UI rendering, or message state.
- Keep the MasonDrawer sidebar — don't touch its layout.
- Mode dropdown stays functional; just make it visually smaller.
- Target: feels like a focused messaging interface, not a dashboard widget.

## Implementation Routing
- Frontend: `frontend/src/pages/Chat.module.css`, `frontend/src/pages/Chat.tsx` (bubble/avatar/thinking JSX only)
