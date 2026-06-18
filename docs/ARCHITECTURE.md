# ARCHITECTURE.md — Main Street

Treat this file as authoritative. Do not override without explicit user direction.

## Stack

| Component | Technology |
|---|---|
| Backend framework | FastAPI (Python 3.11+) |
| Database | PostgreSQL 16 via SQLAlchemy (async) |
| Cache / sessions | Redis |
| AI agent | Claude Sonnet via Anthropic SDK |
| Semantic search | pgvector embeddings on `products` table |
| Auth | JWT (HS256), `backend/auth.py` |
| Payments | Stripe |
| Analytics | PostHog |
| Frontend framework | React 18 + TypeScript, Vite |
| Styling | Tailwind CSS |
| State | React hooks (no global state manager) |
| Deploy (backend) | Railway |
| Deploy (frontend) | Vercel |

## Directory Layout

```
backend/
  main.py              # FastAPI app entry point
  auth.py              # JWT auth utilities
  config.py            # Settings (env vars)
  agent/
    loop.py            # Mason agent loop, system prompts
  routers/
    agent.py           # Chat/streaming endpoints
    boards.py          # Saved boards
    products.py        # Product catalog
    admin.py           # Admin portal APIs
  db/
    models.py          # SQLAlchemy ORM models
    session.py         # Async session factory
  tests/
    unit/              # Fast unit tests (no Docker)
    integration/       # Require Docker (Postgres + Stripe-mock)

frontend/
  src/
    main.tsx           # App entry, routes
    pages/
      Mason.tsx        # Full-page Mason panel
      Home.tsx         # Landing / chat entry
      Admin.tsx        # Admin portal
    components/
      MasonDrawer.tsx  # Collapsible side panel
      MasonChip.tsx    # Floating mascot button
      A2UICard.tsx     # Product cards in chat
    hooks/             # Shared React hooks
    lib/               # API client, utilities
    a2ui/              # Add-to-UI card rendering
  public/
    mason/             # mason-1.png … mason-10.png

docs/
  APP.md               # Product context
  ARCHITECTURE.md      # This file
  CONVENTIONS.md       # Coding conventions (if created)
  TESTING.md           # Testing policy (if created)
  features/
    status.json        # Feature queue
    <feature-id>/
      FEATURE.md       # Behavior contract
      acceptance/      # Pytest acceptance tests
```

## API Conventions
- All backend routes return JSON.
- Streaming chat uses Server-Sent Events (SSE) — `text/event-stream`.
- Auth: `Authorization: Bearer <jwt>` header on protected routes.
- Admin routes require `is_admin = true` on the User row.

## Data Flow — Mason Chat
```
User message
  → POST /api/agent/chat (or streaming /api/agent/stream)
  → agent/loop.py: build context (memory, prefs, history)
  → semantic search (pgvector) for relevant products
  → Claude Sonnet API call with tool use
  → A2UI cards rendered in frontend from tool results
  → response streamed back
```

## Embedding / Search
- Products are embedded at import time using `text-embedding-3-small`.
- Stored in `products.embedding` (pgvector column).
- Semantic search runs via cosine similarity on the vector column.
- Keyword fallback is available when vector similarity is low.

## Testing Policy
- Unit tests: `pytest -m "not integration"` — fast, no Docker, run in gate.
- Integration tests: `pytest` (all) — require Docker (Postgres + Stripe-mock).
- Gate runs unit tests only; pre-push runs full suite via `scripts/test-all.sh`.
- Frontend: TypeScript type-check via `tsc --noEmit`; ESLint for lint.
