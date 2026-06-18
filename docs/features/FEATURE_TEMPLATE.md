# Feature: <Title>

<!-- One-line summary of what this feature does and why it matters. -->

## Acceptance Scenarios

```gherkin
Feature: <Feature name>

  Scenario: <Happy path>
    Given <context>
    When <action>
    Then <observable outcome>

  Scenario: <Edge case>
    Given <context>
    When <action>
    Then <observable outcome>
```

## Constraints
<!-- Optional: performance targets, security requirements, API compatibility notes. -->

## Implementation Routing
<!-- Optional: name the skills or areas this touches. -->
- Backend: `backend/routers/<router>.py`, `backend/db/models.py`
- Frontend: `frontend/src/pages/<Page>.tsx`, `frontend/src/components/<Component>.tsx`
- Agent: `backend/agent/loop.py` (only if Mason behavior changes)
