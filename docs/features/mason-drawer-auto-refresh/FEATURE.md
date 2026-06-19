# Feature: Mason Drawer Auto-Refresh

The Mason drawer (boards, history, preferences) should update automatically when the agent completes a turn — without the user needing to manually refresh or navigate away. Currently the drawer only updates when the parent Chat component re-fetches on mount.

## Acceptance Scenarios

```gherkin
Feature: Mason drawer auto-refresh

  Scenario: Session list refreshes after each completed turn
    Given I am in a chat session
    When Mason completes a reply
    Then the History tab in the drawer shows the updated session title
    And no manual refresh is required

  Scenario: Boards refresh after saving a product
    Given I save a product to a board during a chat session
    When Mason acknowledges the save
    Then the Boards tab in the drawer shows the newly saved product
    Without requiring a page reload

  Scenario: Drawer refreshes on streaming completion
    Given streaming is active (Mason is replying)
    When the stream ends (done event received)
    Then the drawer triggers a refresh of sessions and memory
    And the updated state is visible within 1-2 seconds

  Scenario: Refresh does not cause flicker or layout shift
    Given the drawer is open on the Boards tab
    When a background refresh occurs
    Then the tab content updates smoothly without visible flash
```

## Constraints
- The refresh should trigger when `streaming` transitions from `true` → `false` in `useAgentStream`.
- Call `memory.refresh()` and re-fetch sessions after each turn completion.
- Do not add polling — use the existing streaming done signal.
- The `useMasonMemory` hook already has a `refresh()` method — use it.
- Sessions are fetched in Chat.tsx via `api.listSessions` — trigger a re-fetch after turn done.

## Implementation Routing
- Frontend: `frontend/src/pages/Chat.tsx` — add useEffect watching `streaming` → false transition to re-fetch sessions and call memory.refresh()
- Frontend: `frontend/src/components/MasonDrawer.tsx` — ensure it re-renders when memory/sessions props update
