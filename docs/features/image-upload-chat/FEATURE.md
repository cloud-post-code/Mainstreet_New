# Feature: Image Upload in Mason Chat

Users can attach an image to a Mason chat message. Mason receives the image and can use it to understand what the user is looking for (e.g. "find me something like this").

## Acceptance Scenarios

```gherkin
Feature: Image upload in Mason chat

  Scenario: Image attach button is visible in the composer
    Given I am on the Mason chat page
    Then I see a paperclip or image icon button in the chat composer

  Scenario: Tapping the attach button opens a file picker
    When I tap the attach button
    Then a file picker opens filtered to image types (jpg, png, gif, webp)

  Scenario: Selected image shows a preview before sending
    Given I have selected an image file
    Then a small thumbnail preview appears above the textarea
    And I can remove it with an ×  button before sending

  Scenario: Sending a message with an image
    Given I have attached an image and typed a message
    When I press send
    Then the image is uploaded and the message is sent with the image reference
    And Mason's reply acknowledges the image and responds appropriately

  Scenario: Sending image-only (no text)
    Given I have attached an image but typed no text
    When I press send
    Then the message sends with just the image
    And Mason responds based on the image alone

  Scenario: File too large is rejected
    Given I select an image larger than 5 MB
    Then I see an error message saying the file is too large
    And the file is not attached
```

## Constraints
- Max file size: 5 MB. Accepted types: jpg, png, gif, webp.
- Upload to `POST /api/agent/upload-image` (new endpoint) — returns a URL or reference ID.
- The image URL/ID is included in the chat message payload sent to Mason.
- Mason's backend receives the image as a base64-encoded part of the Anthropic API message (vision support already exists via Claude Sonnet).
- Reuse the existing upload infrastructure in `backend/agent/uploads.py` if applicable.
- Only one image per message.

## Implementation Routing
- Backend: `backend/routers/agent.py` or `backend/agent/uploads.py` — image upload endpoint
- Frontend: `frontend/src/pages/Mason.tsx` — attach button, preview, include in send payload
