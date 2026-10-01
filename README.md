# Fitness OS
See `docs/ARCHITECTURE_PROPOSAL.md`.

## Phase 1 status (foundation)
- `packages/core` — deterministic target engine (BMR/TDEE/macros/fibre/steps) + tests
- `packages/db/migrations/0001_foundation.sql` — profiles, goals, targets, history, consents, admin, settings, RLS
- `apps/web` — Vite + React: auth, onboarding, dashboard shell, responsive nav, placeholder routes

## Run
    pnpm install && pnpm test && pnpm typecheck
    cp apps/web/.env.example apps/web/.env   # fill Supabase URL + anon key
    pnpm --filter @fitness-os/web dev

## Not yet done / known gaps
- RLS tests against a real Postgres (migration not yet applied/verified against Supabase)
- Onboarding writes are multiple client calls (not atomic); move to an RPC/API endpoint
- Settings, account export/delete, privacy/terms pages, e2e + responsive tests
