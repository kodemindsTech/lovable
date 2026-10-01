# Fitness OS
See `docs/ARCHITECTURE_PROPOSAL.md`.

## Status
**Phase 1 (foundation) — done.** **Phase 2 (nutrition) — done.**
- `packages/core` — target engine, nutrition math, deterministic meal-text parser (tested)
- `packages/db` — migrations (`0001` foundation, `0002` atomic onboarding + account deletion, `0003` nutrition), draft food seed, and a PGlite-based test suite for RLS, RPCs, search, totals and deletion
- `apps/web` — Vite + React: auth, onboarding (single RPC), dashboard, nutrition logging (search + describe-a-meal, edit, delete, water), settings (export / delete account), draft privacy & terms

## Run
    pnpm install && pnpm typecheck && pnpm test
    cp apps/web/.env.example apps/web/.env   # Supabase URL + anon key
    pnpm --filter @fitness-os/web dev
Apply `packages/db/migrations/*.sql` in order, then `packages/db/seed/foods.sql`, to your Supabase project.

## Known gaps / caveats
- Migrations are tested on PGlite with a stubbed `auth` schema, not yet on a real Supabase project.
- **Food seed is a draft**: ~60 approximate per-serving values, labelled `ai_estimated` (shown as "Estimate" in the UI). Needs nutritionist review / IFCT cross-checking before promotion.
- Web UI has only helper unit tests; no automated e2e (one manual mocked-backend responsive check). No tests against real Supabase Auth.
- Voice and photo logging are not built. Privacy/Terms are placeholders pending legal review.
- Account deletion removes DB rows via `auth.users` cascade; storage/provider-side purge is needed once uploads exist.
