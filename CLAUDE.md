# CLAUDE.md — Main Street Operating Contract

## Purpose
This file gives Claude Code the repo-wide operating contract: what to optimize for, where to
route work, and when work is allowed to be called complete.

Repo docs own durable project context when present:
`docs/APP.md`, `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`, and `docs/TESTING.md`.

---

## Working Model
- Work one feature or issue at a time.
- Source of truth for any feature: `docs/features/<feature-id>/FEATURE.md`.
- If no feature dir is specified:
  - inspect `docs/features/*/FEATURE.md` for one clear match;
  - use that match when exactly one is clear;
  - otherwise create `docs/features/<request-slug>/FEATURE.md`;
  - ask only when multiple plausible matches would materially change scope.

---

## Project Architecture
Main Street is a **neighborhood-style AI shopping assistant**. The stack is:

| Layer | Tech |
|---|---|
| Backend | Python (FastAPI), PostgreSQL, SQLAlchemy, Redis |
| Frontend | React + TypeScript (Vite), Tailwind CSS |
| AI Agent | Claude Sonnet via Anthropic SDK (`backend/agent/loop.py`) |
| Auth | JWT tokens, `backend/auth.py` |
| Payments | Stripe |
| Analytics | PostHog |
| Deploy | Railway (backend + frontend + DB + Redis) |
| Database | Supabase (PostgreSQL, hosted on Railway) |

Standard layout (already in place):
```
backend/       # FastAPI app, agent, routers, db, tests
frontend/      # React/TS Vite app
docs/          # APP.md, ARCHITECTURE.md, features/
scripts/       # gate, test.sh, test-all.sh
```

If `docs/ARCHITECTURE.md` exists, treat it as authoritative and apply it.
Do not override project architecture unless explicitly asked.

---

## Feature Queue
- `docs/features/status.json` is the durable progress queue.
- Read it to find the next `pending` feature; update it when status changes.
- Valid statuses: `pending`, `in_progress`, `passing`, `failing`, `blocked`.
- Do not mark a feature `passing` because implementation looks plausible.
- A feature is `passing` only when: `scripts/gate` exits 0 AND `scripts/acceptance` exits 0 AND
  a self-review of the diff confirms all acceptance scenarios in `FEATURE.md` are covered.
- If a check fails, fix and re-run — max 3 repair attempts before marking `blocked`.
- If blocked, record the concrete reason in `status.json` and stop.

---

## Task Routing
| Task | How to handle |
|---|---|
| Plan or spec a feature | Write `docs/features/<slug>/FEATURE.md` using the template |
| Implement a feature | Read `FEATURE.md` → red/green TDD → `scripts/gate` → `scripts/acceptance` |
| Fix a reported bug | Reproduce with a failing test → minimal fix → re-run narrowest test |
| Repair a failing gate/lint | Run the failing check → isolate → smallest fix → re-run |
| Design or visual work | `/design-review` or `/design-shotgun` gstack skills |
| Ship / open PR | `/ship` gstack skill |
| Security audit | `/cso` gstack skill |
| QA a user flow | `/qa` gstack skill |
| Research | `/deep-research` gstack skill |

---

## Verification — Gate Script
The authoritative check for this repo is:

```bash
scripts/gate
```

This script auto-detects the stack and runs: ruff format check → ruff lint → mypy → pytest unit
tests. See `scripts/gate` for the full sequence.

Feature acceptance (when a feature dir is in scope):

```bash
scripts/acceptance --feature docs/features/<feature-id>
```

Do not claim done unless gate passes and, when applicable, acceptance passes.

---

## Implementation Discipline
- Reuse existing code first.
- Make the smallest change that satisfies the feature or issue.
- Keep changes local; avoid unrelated refactors.
- Prefer explicit code over cleverness.
- Use red/green TDD for implementation and bug fixes.
- Do not delete, weaken, or bypass tests to get green.

---

## Hard Limits
- ≤100 lines per function.
- Cyclomatic complexity ≤8.
- ≤5 positional parameters.
- 100-character line width (Python: enforced by ruff).
- If a limit would make the design worse, state the reason.

## Zero-Warning Standard
- Treat warnings as defects in touched scope.
- Fix ruff, mypy, and TypeScript warnings in touched files.
- If a warning must remain, add a local ignore with a one-line justification.

---

## Review Order
Architecture → code quality → tests → performance.
Include concrete impact and file:line references in findings.

## Dependency Hygiene
- Use current stable versions; pin explicitly in `requirements.txt` and `package.json`.
- Run `pip-audit` when Python deps change; run `npm audit` when Node deps change.
- Do not add dependencies when existing stdlib or repo patterns are sufficient.

## Secret Safety
- Preserve existing secret values when editing `.env`, Railway config, or CI files.
- Do not replace secrets with placeholders.
- Do not print raw secrets in responses or logs.

## Deployment
- All services (backend, frontend, database, Redis) run on **Railway**.
- Pushing to `main` on GitHub automatically triggers a Railway deploy — no manual deploy step needed.
- Backend URL: `https://backend-production-c5f5.up.railway.app`
- There is no Vercel deployment. Do not reference Vercel for this project.
- Database is PostgreSQL managed via Railway (originally provisioned through Supabase).

## Safety
- Do not force push, deploy, or run destructive commands unless explicitly requested and approved.

---

## Completion Checklist
For every completed feature or issue, confirm and report:
- What changed and which files were touched
- Red evidence (failing test before the fix) and green evidence (passing after)
- `scripts/gate` result (pass or specific failures)
- `scripts/acceptance` result when a feature dir is in scope
- Queue status updated in `docs/features/status.json`
- Any concrete blockers

If blocked: `NEED_INPUT: <question>` or `BLOCKED: <reason>`.

---

## Mason — AI Agent Context
Mason is Main Street's AI shopping assistant. Key files:
- Personality + system prompt: `backend/agent/loop.py` (lines 92–275)
- Memory chat mode: `backend/agent/loop.py` (lines 376–412)
- Routing: `backend/routers/agent.py`
- Full Mason spec: `MASON.md`

When touching Mason behavior, read `MASON.md` and `backend/agent/loop.py` first.
Do not change Mason's voice or personality without explicit user direction.
