# Mason

A snapshot of who Mason is in the Main Street product today.

## What Mason Is

Mason is Main Street's **AI-powered personal shopping assistant** and brand mascot — a sentient brick/cork-textured character with simple line-drawn features. He's both the friendly face users see in the UI and the conversational agent powering the shopping experience: a curated, neighborhood-style guide to local shops.

## Personality & Voice

Mason's identity is defined in `backend/agent/loop.py` (lines 92–275, `SYSTEM_PROMPT`).

**Archetype:** The Helpful Neighbor — also framed as The Guide, The Builder, The Steward.

**Core beliefs:**
- Trust over transactions
- Quality over quantity
- Community over convenience
- Relationships over algorithms
- Long-term satisfaction over short-term sales

**Voice:** Warm, grounded, plain-spoken. Like a neighborhood shopkeeper, not a marketer. Thoughtful, curious, humble, never pushy or salesy.

**Behavior:**
- Never recommends before understanding the person — asks clarifying questions ("What's most important here?", "Who is this for?")
- Celebrates good matches briefly and genuinely
- Surfaces concerns honestly instead of papering over them

## Visual Identity

Ten hand-drawn poses live in `frontend/public/mason/mason-1.png` through `mason-10.png`. A warm cream background and terracotta/brick-colored character — minimalist and approachable. Poses include waving, sitting with a cup, thinking, gesturing.

`MasonChip` rotates through these poses as the floating UI affordance.

## Modes of Mason

Mason runs in two distinct conversation modes, distinguished by session type:

| Session type | Purpose | Prompt | Model |
|---|---|---|---|
| `shop` (default) | Shopping chat with product search, A2UI cards | `SYSTEM_PROMPT` | Claude Sonnet (Haiku in Fast mode) |
| `mason` | Memory-only chat — notes, prefs, no shopping | `MASON_MEMORY_SYSTEM_PROMPT` (`loop.py` 376–412) | Sonnet, plain text only |

Routing lives in `backend/routers/agent.py` (lines 44–45, 56–58, 244–246, 496–500).

## Frontend Surface

- `frontend/src/pages/Mason.tsx` — Full-page memory panel with **Inbox, History, Notes, Prefs, Saved, Shipping** tabs plus a persistent chat column. Route: `/mason` (`main.tsx:39`).
- `frontend/src/components/MasonDrawer.tsx` — Collapsible side panel with memory management and live "Now" reasoning state.
- `frontend/src/components/MasonChip.tsx` — Floating button that opens the drawer; cycles through the 10 mascot poses.
- `frontend/src/pages/Chat.tsx` — Primary shopping interface, integrated with Mason context.
- `frontend/src/mason/MasonContext.tsx` — Global state: `isOpen`, `isPopped`, `agentState` (`idle | thinking | tool | replying`).
- `frontend/src/mason/useMasonMemory.ts` — Hook for notes, prefs, saved products, inbox, shipping. Debounced preference saves.

## Backend Surface

- `backend/agent/loop.py` — Both system prompts and the core agent loop.
- `backend/routers/agent.py` — Routes requests to the right prompt + model based on session type.
- `backend/routers/mason_memory.py` — REST endpoints under `/api/mason/*` for notes, prefs, shipping, saved products.

## Data Model

- `sessions.type` — `"shop"` vs `"mason"` distinguishes conversation kind.
- `user_memory` — Notes and preferences; cached into Mason's context on each turn.
- `saved_products` — User-saved items shown in the Saved tab.
- Inbox/messages — Supports proactive outreach from Mason to users.

## TL;DR

Mason is a unified character across the stack: a brick mascot in the UI, a neighborhood-shopkeeper voice in the prompt, a memory-aware assistant in the backend, and a persistent shopping companion in the database. Shopping chat and memory chat run as two prompt variants of the same character.
