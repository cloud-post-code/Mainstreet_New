# APP.md — Main Street

## Product
Main Street is an AI-powered personal shopping assistant that connects people to curated local and
independent shops. The assistant, Mason, acts as a knowledgeable neighborhood guide — understanding
what the customer needs before making recommendations, surfacing products with genuine context
rather than algorithm-driven noise.

## Target User
People who prefer shopping at independent, local, or curated stores but don't have time to browse
each one individually. They value trust, quality, and community over convenience and price.

## Core Outcome
A user describes what they need. Mason asks clarifying questions, understands context, then
surfaces specific products from real shops — presented as A2UI cards with images, prices, and
add-to-cart actions. The user can save boards, track preferences, and return to a persistent
shopping companion.

## Product Shape
- **Mason chat** — conversational shopping interface; semantic product search via embeddings
- **Boards** — saved product collections, image-only grid, shareable
- **Mason memory panel** — notes, preferences, shipping info, saved items, history
- **Admin portal** — shop/product management, CSV import, AI listing agent, analytics

## Scope Cuts (v1)
- No real-time inventory sync (catalog is static until re-imported)
- No checkout (links out to shop websites; Stripe handles on-platform purchases for participating shops)
- No social/community features

## Key Constraints
- Mason's personality and voice must remain consistent; see MASON.md
- All product recommendations must be grounded in actual catalog data
- No hallucinated products or prices
