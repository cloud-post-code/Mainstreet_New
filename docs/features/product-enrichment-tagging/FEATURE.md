# Feature: Admin Product Enrichment & Tagging Pipeline

An admin-triggered pipeline that enriches unprocessed products with jobs-to-be-done, personas, SEO keywords, and a new embedding — using GPT-4o-mini and a chained prompt sequence. Replaces the current embedding-only job for newly enriched items.

## Acceptance Scenarios

```gherkin
Feature: Product enrichment pipeline

  Scenario: Enrichment button appears in the admin portal
    Given I am on the Admin page
    When I view the batch operations section
    Then I see an "Enrich Products" button distinct from the existing "Generate Embeddings" button

  Scenario: Triggering enrichment only processes unenriched products
    Given some products have already been enriched (enriched_at is set)
    When I click "Enrich Products"
    Then only products where enriched_at IS NULL are processed
    And already-enriched products are skipped

  Scenario: Enrichment runs the prompt chain in order
    Given a product is being enriched
    Then the pipeline runs in this order:
      1. Context summary (GPT-4o-mini, max 100 words from product data)
      2. Jobs-to-be-done (3 end-user + 3 gift-giver, using context)
      3. Personas (end-user + gift-giver, using context)
      4. SEO keywords (exactly 20, using context + jobs + personas)
    And the output of each step feeds as context into the next step

  Scenario: Enrichment stores results and generates a new embedding
    Given enrichment has completed for a product
    Then the product's description.tags is updated with the 20 SEO keywords
    And a new embedding is generated from the enriched text (replacing the old one)
    And enriched_at is set to the current timestamp
    And the jobs, personas, and keywords are stored in the product's enrichment_data JSONB field

  Scenario: Progress is shown while enrichment runs
    Given enrichment is in progress
    Then I see a live counter: "X / Y products enriched"
    And I see elapsed time and estimated time remaining

  Scenario: Enrichment is idempotent
    Given I click "Enrich Products" a second time
    Then only products added since the last run are processed
    And no previously enriched product is re-processed
```

## Constraints
- Model: `gpt-4o-mini` (OpenAI) for all enrichment prompts — smallest capable model.
- The exact prompts to use (verbatim, do not alter):
  - **Step 1 — Context:** "You are an automatic product enrichment system.\n\nUse ONLY the provided product data.\nDo NOT invent details.\nMaximum 100 words.\n\nPRODUCT:\nName: {{product_name}}\nCategory: {{category_name}}\nDescription: {{description}}\nImages:\n{{images}}\n\nReturn ONLY:\nCONTEXT: ..."
  - **Step 2 — Jobs:** "Based ONLY on the context below, generate 6 jobs.\n\nCONTEXT:\n{{context}}\n\nFORMAT:\nEND_USER_JOB_1: [Job Name] | [Category] | When [situation], I want to [motivation], so I can [desired outcome].\n..." (3 end-user + 3 gift-giver)
  - **Step 3 — Personas:** "Using ONLY this context:\n{{context}}\n\nFORMAT:\nEND_USER_PERSONA:\nIDENTITY: [max 25 words]\n..." (end-user + gift-giver personas)
  - **Step 4 — Keywords:** "Using the provided product context, jobs-to-be-done, and user personas:\n{{context}}\n\nGenerate EXACTLY 20 SEO search keywords... one per line, single real English word only, letters A–Z only..."
- New database columns needed: `enriched_at TIMESTAMP`, `enrichment_data JSONB` on the Product model.
- The embedding generated after enrichment replaces the existing embedding — same pgvector column, same model (`text-embedding-3-small`), but built from enriched canonical text.
- Batch size: 10 products at a time (GPT rate limits).
- Admin-only endpoint: `POST /api/admin/enrich-products` and `GET /api/admin/enrich-products/status`.

## Implementation Routing
- Backend: `backend/routers/admin.py` — enrich endpoints; `backend/agent/embeddings.py` — enrich pipeline function; `backend/db/models.py` — new columns + migration
- Frontend: `frontend/src/pages/Admin.tsx` — Enrich Products button + live progress display
