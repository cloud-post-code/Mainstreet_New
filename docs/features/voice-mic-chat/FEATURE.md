# Feature: Voice Mic Input in Mason Chat

Add a microphone button to the Mason chat composer. When tapped, it records the user's voice, transcribes it, and populates the text input — ready to send or edit before sending.

## Acceptance Scenarios

```gherkin
Feature: Voice mic in Mason chat

  Scenario: Mic button is visible in the chat composer
    Given I am on the Mason chat page
    Then I see a mic icon button next to the send button in the composer

  Scenario: Tapping mic starts recording
    Given the browser has microphone permission
    When I tap the mic button
    Then the button changes to indicate recording is active (red or pulsing state)
    And the browser begins capturing audio

  Scenario: Stopping recording transcribes speech to text
    When I tap the mic button again to stop recording
    Then the recorded audio is sent to the transcription endpoint
    And the transcribed text appears in the chat textarea
    And the mic button returns to its idle state

  Scenario: Mic button is disabled when permission is denied
    Given the browser has denied microphone permission
    When I tap the mic button
    Then I see a clear error or tooltip explaining microphone access is required
    And no recording starts

  Scenario: Transcription error is handled gracefully
    Given recording has completed
    When the transcription API call fails
    Then I see a brief error message
    And the textarea is not modified
```

## Constraints
- Use the browser's native `MediaRecorder` API — no external recording library.
- Transcription via `POST /api/agent/transcribe` (new backend endpoint wrapping OpenAI Whisper `whisper-1`).
- Audio sent as `audio/webm` blob.
- The mic button must be the same visual size as the send button.
- Do not auto-send after transcription — user reviews text first.

## Implementation Routing
- Backend: `backend/routers/agent.py` — add `POST /api/agent/transcribe` endpoint
- Frontend: `frontend/src/pages/Mason.tsx` — mic button in composer, MediaRecorder logic
