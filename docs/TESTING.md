# Testing

Run everything: `pnpm typecheck && pnpm test && pnpm e2e`.

| Suite | Where | What it proves | Needs |
|---|---|---|---|
| Core | `packages/core/test` | Targets/BMR/macros, nutrition math, meal parser, progression, score, next-action, reports, billing state machine | – |
| Database | `packages/db/test` | Migrations on PGlite: RLS isolation per table, RPCs, search, totals, deletion cascade, admin roles, audit, quotas, entitlements, schema/security invariants | – (WASM Postgres with a stubbed `auth` schema) |
| AI | `packages/ai/test` | Context builder, output schema, safety pre/post checks, numeric grounding, fallbacks, narrative | stub LLM only |
| Data / API | `packages/data`, `apps/api/test` | Aggregation, auth, consent, gating, quotas, webhooks (HMAC, idempotency), headers, CORS | fakes |
| Web unit | `apps/web/src/**/*.test.ts` | Helpers, settings validation | – |
| E2E | `apps/web/e2e` | 27 scenarios × mobile (390px) and desktop (1280px): every main page renders, no horizontal overflow, **axe WCAG 2 A/AA: no serious/critical violations**; onboarding, food logging, retry, coach, gating, announcements, export, deletion | Chromium (`PW_CHROMIUM` or `playwright install chromium`); backend is mocked in the browser |

## PRD §54 coverage
| Area | Status |
|---|---|
| Authentication | **Not tested** — needs a real Supabase Auth project (UI renders and is axe-clean) |
| Onboarding | DB (atomic RPC, under-18 rejection) + e2e (engine output, validation) |
| Calorie / macro calculations | Core unit tests; server snapshot totals tested in DB |
| Food / workout / weight logging | DB tests; e2e for food logging flow |
| Daily score, AI context, AI response parsing | Core / AI unit tests |
| Permissions & RLS | DB tests incl. schema invariants |
| Subscription access | DB + API tests (plan gating, grace, lapse) |
| Account deletion | DB cascade invariant + e2e UI flow |
| Mobile & desktop responsiveness | e2e at two viewports |

## Not covered
Live Supabase (auth, PostgREST, default grants), a real LLM, a real payment provider, load/performance testing, cross-browser (Chromium only), real-device testing, screen-reader manual testing.
