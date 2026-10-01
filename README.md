# Fitness OS
See `docs/ARCHITECTURE_PROPOSAL.md`.

## Status
**Phase 1 (foundation) — done.** **Phase 2 (nutrition) — done.** **Phase 3 (workouts) — done.** **Phase 4 (activity, running, weight) — done.** **Phase 5 (intelligence) — done.** **Phase 6 (AI coach) — done.** **Phase 7 (reporting) — done.** **Phase 8 (monetisation) — done, except a real payment provider.**
- `packages/core` — target engine, nutrition math, deterministic meal-text parser (tested)
- `packages/db` — migrations (`0001` foundation, `0002` atomic onboarding + account deletion, `0003` nutrition), draft food seed, and a PGlite-based test suite for RLS, RPCs, search, totals and deletion
- Phase 3: `0004_workouts.sql` (exercises, sessions, sets, templates, derived exercise history) + `seed/exercises.sql` (36 draft exercises) + deterministic double-progression rules in `core/progression.ts`
- Phase 4: `0005_activity_progress.sql` (activities, running sessions, weight, body measurements, integration placeholders) + `core/progress.ts` (weight 7-day average / 30-day trend, pace, weekly/monthly distance, personal bests)
- Phase 5: `core/score.ts` (Daily Fitness Score: deterministic 0–100 adherence score, weights configurable via `app_settings.score_weights`, components without data are excluded not zeroed, in-progress days judged on pace) and `core/nextAction.ts` ("What should I do now?": 1–3 prioritised rule-based actions with real catalog food suggestions, diet-filtered, safety rules); `0006_intelligence.sql` (`daily_scores` cache)
- Phase 6:
  - `packages/ai` — context builder (compact, PII-free), structured output schema (Zod), safety layer (pre-check routes self-harm / eating-disorder / extreme-diet / medical messages to fixed vetted replies *without calling the model*; post-check rejects banned advice and numbers not present in the data), provider-agnostic `LLMClient` + Anthropic Messages API client, and the coach pipeline with one repair retry and a deterministic rules fallback. The engine's score always overrides anything the model says.
  - `apps/api` — Fastify service. `POST /v1/coach/messages` authenticates the Supabase JWT, acts *as the user* (RLS, no service-role key), requires `ai_processing` consent, enforces a server-side daily quota (`ai_consume`), rate-limits, and persists the conversation. Config: `apps/api/.env.example`. Run: `pnpm --filter @fitness-os/api dev`.
  - `0007_ai.sql` — conversations, messages, usage (read-only for users), consent check, quota function.
- Phase 7:
  - `core/reports.ts` — period stats (averages over days that have data, never zero-filled), meaningful-change detection ("What changed?"), weekly/monthly report with improved / declined / biggest priority / next focus, all deterministic.
  - `packages/data` — shared RLS-scoped data loaders (`computeReport`) used by both the web app and the API.
  - `packages/ai/narrative.ts` + `POST /v1/reports/narrative` — optional AI-written summary of the already-computed report; same grounding/safety checks and rules fallback as the coach. Separate `report_daily` quota.
  - `0008_reports.sql` — `weekly_reports` cache, `nutrition_targets.tdee` (for the *estimated* energy balance), report quota.
  - Web: Reports page (Weekly / Monthly / What changed?) and a "What changed" card on the dashboard.
- Phase 8:
  - `core/billing.ts` — subscription state machine (start, trial, renewal, payment failure → grace period, cancel at period end / immediately, upgrade immediately / downgrade at renewal, stale-event protection) + `effectivePlan` and feature keys.
  - `0009_billing.sql` — `plans`, `plan_prices` (INR minor units), `plan_features` (per-plan, with daily AI limits), `subscriptions`, `subscription_events` (idempotency key), `current_entitlements()`, `effective_plan()`, plan-aware `ai_consume()` (fail-closed), server-only `apply_subscription_event()`. Prices, limits and features are table data seeded with the PRD's target-test prices; nothing is hard-coded in app code. Users cannot write subscriptions.
  - `apps/api` — `POST /v1/billing/checkout|cancel|change` and `POST /webhooks/billing` (raw-body, signature-verified, idempotent) behind a `BillingProvider` interface; AI endpoints return `402 upgrade_required` for plans without the feature (crisis/safety replies are never gated).
  - Web: Subscription page, public Pricing page (reads plans from the DB), `FeatureGate`, entitlements context; Coach, Daily Fitness Score, weekly/monthly reports and workout progression are gated per the PRD's Pro tier.
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
- Exercise instructions are short generic cues, not individual coaching; progression suggestions use fixed rep range 8–12 (not yet user-configurable). Per-exercise history is derived by query, not stored in a separate `exercise_history` table.
- No activity integrations exist: the UI shows "Connect activity source" and all activity is manual-sourced. Health Connect/HealthKit need a native wrapper; Strava/Fitbit/Garmin need partner approval. No route/GPS data is stored.
- Score weights/thresholds (calorie bands, 30-min activity, pace-of-day model, under-eating nudge at <50% after 20:00) are my defaults and need product/nutritionist sign-off. Score is computed client-side from the user's own data and cached in `daily_scores`; move to a server job before any feature depends on it being tamper-proof (e.g. challenges).
- **AI is untested against a real LLM**: no API key was available. Tests use stub models; the Anthropic client is exercised only against a mocked `fetch`. Set `ANTHROPIC_API_KEY` + `AI_MODEL` in `apps/api` and review real outputs/safety behaviour before launch. Without them the coach answers from the rules engine and says so.
- The safety pre-check is a regex heuristic (English only), not a clinical classifier; it will miss paraphrases and could over-trigger. Needs expert review, multilingual coverage and monitoring of flagged chats (admin AI monitoring is Phase 9).
- Numeric grounding checks numbers with units; it can reject valid answers (falls back to rules) and can't verify non-numeric claims.
- `apps/api` data loader (`loader.ts`) is not tested against a live Supabase/PostgREST; its pure aggregation is. It duplicates some gathering logic in `apps/web/src/lib/intelligence.ts` — consolidate later.
- Quota is a flat `coach_daily` in `app_settings`; plan-based limits come with subscriptions (Phase 8). The rate limiter is in-memory per instance. The AI coach is not yet gated to Pro.
- Reports are computed on demand when viewed (not by a scheduled job), so "automatic" generation means any week/month is available instantly; there are no push/email report notifications yet. Monthly reports are not cached.
- "What changed?" uses rolling 7/30-day windows rather than calendar weeks/months (clearer for in-progress periods); yesterday-vs-today is nutrition/steps only and labelled "so far today".
- Estimated energy balance = average logged intake − TDEE (from onboarding). It's an estimate, ignores unlogged days, and is only shown for accounts that have a stored TDEE and ≥3 logged days. Change thresholds (e.g. ±10% protein, ±1,000 steps, ±0.3 kg) and the "day on plan" definition (calorie band + protein ≥90%) are my defaults and need review.
- **No real payment provider is implemented.** `BillingProvider` has only a `FakeBillingProvider` (HMAC-signed webhooks, development/test only; the API refuses to start with it when `NODE_ENV=production`). Real checkout/webhooks (e.g. Razorpay Subscriptions + UPI autopay) need your merchant account, plan ids, API keys and webhook secret, and must be tested against the provider's sandbox. Billing endpoints answer 503 until configured. GST/invoicing, refunds, proration rules, dunning emails and a customer portal are not built.
- **Gating is only server-enforced for AI** (coach and report summaries, via the plan check in `ai_consume` and the API). Daily score, reports and progression suggestions are computed in the browser from the user's own data, so their gate is a UI gate; moving that computation server-side is needed if it must be tamper-proof.
- `subscription_events` rows are deleted with the account (cascade). Whether billing records must be retained for tax/legal reasons needs a decision with legal/finance. `effective_plan()` (SQL) and `effectivePlan()` (TS) are duplicated and tested against the same scenarios; the SQL reads skew hours from `app_settings.billing`, the TS default must match.
- Plan feature lists include items not built yet (voice logging, AI meal planning, etc.); the UI marks those "coming soon". Don't sell them until they exist.
- Voice and photo logging are not built. Privacy/Terms are placeholders pending legal review.
- Account deletion removes DB rows via `auth.users` cascade; storage/provider-side purge is needed once uploads exist.
