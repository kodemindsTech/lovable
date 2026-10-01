# AI Fitness OS — Architecture & Implementation Proposal

Status: **Proposal — awaiting approval. No code has been written.**
Source: Master PRD v1.0 (§58 "Claude's First Task").

---

## 0. PRD analysis: ambiguities & gaps

| # | Ambiguity / gap | Proposed default |
|---|---|---|
| 1 | "Web + responsive mobile web, native possible" | Next.js/React SPA-style PWA; business logic in a framework-agnostic `core` package so React Native can reuse it later. |
| 2 | Food database source for Indian foods is unspecified. IFCT 2017 (NIN) is the only authoritative open Indian composition table; branded/restaurant data has licensing risk. | Seed from IFCT 2017 + manually curated common dishes (`verification_status = admin_reviewed`). Verify licence terms before ingest. |
| 3 | Target formulas not specified. | Mifflin-St Jeor BMR; activity multipliers 1.2/1.375/1.55/1.725/1.9; goal-based kcal adjustment with hard floors; protein g/kg by goal; fat 25% kcal (min 0.6 g/kg); carbs = remainder; fibre 14 g/1000 kcal (min 25 g); step target by activity level. Pure functions, versioned, unit-tested. |
| 4 | Deficit/surplus rate limit. | Cap at 1% body weight/week loss, ≤ 0.5% gain; kcal never below 1,200 (F) / 1,500 (M) without override + warning. Needs sign-off. |
| 5 | "Daily Fitness Score" weights unspecified. | Configurable weights in `app_settings` (default: calories 30, protein 25, fibre 10, activity 15, workout 15, goal 5). Score is deterministic, not AI. |
| 6 | Score field appears in the AI output contract (§24) but §2 says AI doesn't calculate. | Engine computes score; AI only writes the *explanation*. The AI-returned `score` is ignored/validated against the engine. |
| 7 | Time-of-day logic for "What should I do now?" needs user timezone and meal-time habits. | Store IANA timezone on profile; day boundary = user local midnight. |
| 8 | Minors: audience starts at 18. | Hard 18+ gate at onboarding (DPDP Act 2023 requires verifiable parental consent for <18). |
| 9 | Health-data compliance (India DPDP Act 2023; GDPR/HIPAA-adjacent for later). | Consent records, purpose limitation, export/delete, data-region choice (Mumbai/Singapore). Legal review before launch. |
| 10 | Payments for India (UPI autopay, RBI e-mandate rules) vs. international. | Razorpay (India) behind a `BillingProvider` interface; Stripe later. |
| 11 | Free-tier AI cost control, rate limits, quota. | Per-tier daily AI quotas in `app_settings`; hard server-side enforcement. |
| 12 | Image recognition accuracy for Indian mixed dishes is poor; portion estimation worse. | Always user-confirmed, labelled `ai_estimated`, confidence-gated. Ship after MVP (PRD "should have"). |
| 13 | "Admin" scope is huge (§39) vs. ₹3–5 lakh prototype budget. | Admin = Supabase Studio + a thin internal page for food/exercise review in MVP; full panel in Phase 9. |
| 14 | Prototype budget ₹3–5 lakh vs. 30 acceptance criteria incl. admin + gating + deletion. | Tight; see risks. Recommend cutting admin UI and subscription *billing* from prototype (keep gating via a flag). |

---

## 1. System architecture

```
┌────────────────────────── Client (PWA, React + TS) ──────────────────────────┐
│ Routes · Design system · TanStack Query cache · Offline write queue (later)  │
│ packages/core (pure TS): targets, nutrition math, score, rules, parsers      │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ HTTPS (Supabase JWT)
┌──────────────▼───────────────┐   ┌───────────────────────────────────────────┐
│ Supabase                     │   │ API service (Node/TS, Fastify)            │
│  Auth · Postgres + RLS       │◄──┤  - Recommendation orchestrator            │
│  Storage (private buckets)   │   │  - AI gateway (provider-agnostic)         │
│  Realtime (optional)         │   │  - Billing webhooks, integrations sync    │
│  Edge/cron (reports)         │   │  - Rate limiting, audit, analytics emit   │
└──────────────────────────────┘   └───────┬───────────────────┬───────────────┘
                                           │                   │
                                  ┌────────▼──────┐   ┌────────▼─────────┐
                                  │ LLM provider  │   │ Razorpay / Health│
                                  │ (server keys) │   │ Connect/Strava…  │
                                  └───────────────┘   └──────────────────┘
```

**Principles realised**
- CRUD with RLS goes **client → Supabase directly** (cheap, fast).
- Anything needing secrets, AI, billing, or cross-user privilege goes through the **API service**.
- `packages/core` is the single source of numeric truth; the same code runs client-side (instant dashboard) and server-side (authoritative score/context). Property-tested.
- Monorepo (pnpm workspaces): `apps/web`, `apps/api`, `packages/core`, `packages/db` (migrations, generated types), `packages/ai` (prompts, schemas), `packages/config`.

## 2. Database ERD (summary)

```
auth.users ─1:1─ profiles ─1:N─ goals
                    │─1:N─ nutrition_targets ─1:N─ target_history
                    │─1:N─ weight_logs, body_measurements, water_logs
                    │─1:N─ meal_logs ─1:N─ food_logs ─N:1─ foods ─N:1─ food_categories
                    │                           └─ (nullable) recipe_id ─ recipes ─1:N─ recipe_items ─ foods
                    │─1:N─ workout_sessions ─1:N─ workout_sets ─N:1─ exercises
                    │─1:N─ exercise_history (materialised PRs/last-performance)
                    │─1:N─ activities ─1:1─ running_sessions
                    │─1:N─ daily_scores, daily_insights, weekly_reports
                    │─1:N─ ai_conversations ─1:N─ ai_messages
                    │─1:N─ subscriptions ─1:N─ subscription_events
                    │─1:N─ notifications, user_integrations, feedback, consents
admin_users, audit_logs, app_settings (flags, pricing, score weights, quotas), plans
```

Design decisions:
- **Nutrition snapshot on `food_logs`**: copy kcal/macros/serving at log time so later edits to `foods` never rewrite history. Also store `source_status` (`verified | user_entered | ai_estimated | admin_reviewed`) — never merged.
- `foods.verification_status` is an enum; user-created foods are private (`owner_id`) until admin-promoted.
- All user rows: `user_id uuid not null`, `created_at`, `updated_at`, soft-delete avoided (hard delete for GDPR/DPDP); `logged_at timestamptz` + `local_date date` (user tz) for fast daily queries.
- Units stored canonically in metric (kg, cm, g, ml, m); display conversion in client.
- `plans` + `app_settings` hold prices/limits/flags (no hard-coded prices — PRD §32).
- Added tables beyond PRD §36: `consents`, `plans`, `plan_features`, `ai_usage` (quota + cost monitoring), `events_outbox` (analytics), `data_export_jobs`.
- Indexes: `(user_id, local_date)` on all log tables; trigram + FTS on `foods.name`.
- Future-proofing (marketplace/corporate): reserve nothing in schema now; add via migrations. Keep `profiles` free of employer fields.

Full DDL will be delivered in Phase 1 as versioned SQL migrations plus RLS policy tests.

## 3. API architecture

Style: REST + JSON, OpenAPI generated from Zod schemas; all inputs/outputs validated.

| Group | Path | Executes in |
|---|---|---|
| Auth, profile, logs CRUD (food, workout, weight, water, activity) | Supabase PostgREST + RLS | Supabase |
| Targets | `POST /v1/targets/recalculate` (uses `core`, stores history) | API |
| Foods | `GET /v1/foods/search?q=` (FTS), `POST /v1/foods/parse` (NL → candidates) | API/DB fn |
| Dashboard | `GET /v1/day/:date` → totals, targets, score + explanation | API |
| Intelligence | `GET /v1/now` (What should I do now?), `GET /v1/changes` | API |
| AI Coach | `POST /v1/coach/messages` (SSE streaming), `GET /v1/coach/conversations` | API |
| Vision/voice (post-MVP) | `POST /v1/food/scan`, `POST /v1/food/voice` | API |
| Reports | `GET /v1/reports/weekly/:week`; cron generates | API/cron |
| Billing | `POST /v1/billing/checkout`, `POST /webhooks/razorpay` | API |
| Account | `POST /v1/account/export`, `DELETE /v1/account` | API (service role, audited) |
| Admin | `/v1/admin/*` (role-checked) | API |

Cross-cutting: JWT verification, per-user rate limits, entitlement middleware (`requireFeature('ai_coach')`), idempotency keys on writes, structured error envelope `{code, message, retryable}`, request IDs, audit log on privileged actions.

## 4. AI architecture

Pipeline (PRD §52):

```
DB rows → core (calc: totals, targets, deficit, score, trends)
        → rules engine (candidate actions, ranked, with reasons)
        → context builder (compact JSON, ≤ ~1.5k tokens, PII-minimised)
        → safety pre-check (red-flag inputs: ED language, extreme targets, symptoms)
        → LLM (JSON-schema constrained output)
        → validator (Zod; reject/repair/fallback)
        → safety post-check (banned content, numeric sanity vs. engine)
        → persist (daily_insights, ai_messages, ai_usage) → UI
```

- **"What should I do now?" is rules-first**: deterministic engine ranks gaps (protein remaining, fibre, kcal budget, activity, workout, time of day) and emits 1–3 structured actions with numbers. The LLM only *phrases* and personalises, and cannot add or change numbers. If the LLM is down/invalid, the rule-based text is shown ("Your data is saved. AI insights are temporarily unavailable.") — never blocking.
- **Output contract** (Zod): `status`, `summary`, `priority`, `recommendations[]`, `confidence`, `safety_flag`. `score` is overwritten from the engine.
- **Coach**: tool-style retrieval — the model asks for structured data via fixed server-defined functions (`get_day`, `get_week`, `get_weight_trend`, `get_workout_history`) instead of receiving the DB; answers must cite the figures used (checked by a numeric-grounding validator).
- **Progression**: pure rules (e.g., double progression: hit top of rep range on all sets → +smallest increment, capped at ≤ 10%/session; deload after 2 failed sessions). LLM never picks weights.
- **Safety layer**: system-prompt guardrails + classifier pass; hard refusals for diagnosis/medication/extreme restriction; below-floor calorie requests produce safe-range messaging; `safety_flag` surfaces help-resources copy. All flagged outputs go to admin AI monitoring.
- **Provider abstraction**: `LLMClient` interface (Anthropic by default, swappable); model IDs in config; prompt versions stored with each `daily_insights`/`ai_messages` row for audit/replay; response caching keyed by context hash (same data → same insight, saves cost).
- **Cost control**: per-tier quotas, small model for phrasing/parsing, larger for Coach; usage logged in `ai_usage`.
- **Estimates labelled**: any AI-derived nutrition has `source_status = ai_estimated` and an "Estimate" chip in UI.

## 5. Frontend architecture

- **Stack**: React 18 + TypeScript, Vite (PWA) *or* Next.js (App Router) — recommend **Vite + React Router** for the app and a separate static marketing/landing site (SEO) to keep the prototype simple. TanStack Query, Zod, React Hook Form, Tailwind + shadcn/Radix primitives (accessible), Recharts/visx for charts, Framer Motion (subtle).
- **Structure**: feature folders (`features/nutrition|workout|activity|progress|coach|reports|settings|onboarding`), each with `api/`, `components/`, `hooks/`, `routes`. Shared `ui/` design system with tokens (colour, type scale, spacing, radii), light/dark.
- **Navigation**: bottom tabs on mobile (Home, Nutrition, Workout, Progress, Coach); sidebar on ≥ lg (PRD §28–29). Route guards for auth, onboarding completion, entitlements.
- **State/data**: server state in TanStack Query; local UI state minimal; optimistic updates for logging; offline-tolerant write queue (post-MVP).
- **Screen state kit**: standard `<ScreenState>` handling loading/empty/error/retry/success with PRD copy; AI failure never blocks saving.
- **A11y/i18n**: WCAG AA contrast, keyboard/focus, reduced motion; i18n scaffolding (en first), units + locale-aware formatting; no India-specific logic in core.
- **Testing**: Vitest (core + components), Playwright (e2e, mobile + desktop viewports).

## 6. Security model

- **AuthN**: Supabase Auth (email+password, Google OAuth, magic link; phone OTP later); MFA for admins.
- **AuthZ / RLS**: every user table `ENABLE RLS` with `user_id = auth.uid()` policies (select/insert/update/delete explicit; no `USING (true)`). Shared catalogs (`foods` verified, `exercises`) read-all, write-admin. User-created foods visible to owner only. Admin via `admin_users` + role claim checked in RLS and API (roles: support, content, finance, super).
- **Secrets**: LLM, service-role, Razorpay, webhook secrets only in API env/secret manager; never in client bundle; CI secret scanning; `.env.example` documents all required keys.
- **Storage**: private buckets, per-user path prefix policies, signed short-lived URLs; image uploads size/type-checked, EXIF-stripped; delete images after analysis unless user opts to keep.
- **API hardening**: input validation, rate limiting, CORS allow-list, CSP, idempotent webhooks with signature verification, SSRF-safe fetches.
- **Prompt-injection**: user text is data, never concatenated into system prompts; tool outputs are schema-validated; model has no write tools (read-only retrieval).
- **Privacy**: consent ledger, data-minimisation, export (JSON/CSV job) and full account deletion (cascading + storage + provider-side purge + audit tombstone with no health data); logs scrubbed of health data; analytics events carry no raw health values.
- **Audit**: `audit_logs` for admin actions, deletions, exports, role changes, billing changes.
- **Compliance**: DPDP Act 2023 notice & consent, ToS/Privacy pages, disclaimer "not medical advice"; legal review before public launch.
- **Testing**: automated RLS tests (user A cannot read/write user B across every table), permission tests, deletion test.

## 7. MVP implementation plan

Honest sizing: PRD §42 "must-have" list + §55 acceptance criteria exceed a ₹3–5 lakh budget if admin UI and billing are fully built. Recommended split:

**Prototype (validation build, ~10–12 weeks, 2–3 engineers)** — PRD phases 1–6 + thin 7, gating by flag
1. **P1 Foundation (wk 1–2)**: monorepo, CI, design system, Supabase schema + RLS + tests, auth, profile, onboarding, `core` targets engine, dashboard shell.
2. **P2 Nutrition (wk 3–4)**: foods seed (IFCT + curated), FTS search, NL parser (deterministic first, LLM-assisted fallback), meal logging/edit/delete, macros, daily dashboard, water.
3. **P3 Workout (wk 5–6)**: exercise seed, session + sets logging, history, rule-based progression.
4. **P4 Activity (wk 6–7)**: manual steps/activity/run entry, weight logs + trend (7-day average), charts. Integrations shown as "Connect activity source" only.
5. **P5 Intelligence (wk 7–8)**: daily score + explanation, "What should I do now?" rules engine.
6. **P6 AI (wk 8–10)**: context builder, structured output, safety layer, Coach, quotas.
7. **P7 Reports (wk 10–11)**: weekly report job + "What changed?".
8. **Hardening (wk 11–12)**: error states, a11y, responsive QA, deletion/export, analytics events, privacy pages.

**Post-validation**: P8 monetisation (Razorpay), P9 admin panel, voice/image logging, Health Connect/Strava, running analytics, P10 production hardening/perf/load.

Per-phase exit gate (PRD §56): tests green → error review → security review (RLS tests) → responsive check → fixes → sign-off.

## 8. Technology recommendations

| Concern | Choice | Why / alternative |
|---|---|---|
| Frontend | React + TS, Vite, Tailwind, Radix/shadcn, TanStack Query | Matches PRD; fast iteration. Next.js only if SEO app pages needed. |
| Backend | **Node/TS (Fastify)** | Shares `core` + Zod types with the client. Python only if heavy ML later. |
| DB/Auth/Storage | **Supabase (Postgres, RLS, Auth, Storage)**, Mumbai/Singapore region | Cheapest path to RLS-first security. |
| Jobs | Supabase cron + API worker (pg-boss) | Weekly reports, exports, deletion. |
| LLM | Provider-agnostic gateway; Anthropic default (JSON-schema outputs, vision for food scan) | Avoid lock-in; model IDs configurable. |
| Speech (post-MVP) | Browser Web Speech API → server STT fallback | Cheap start. |
| Food data | IFCT 2017 + curated; Open Food Facts for packaged goods (check ODbL) | Indian coverage; licensing review. |
| Payments | Razorpay Subscriptions (UPI autopay) behind `BillingProvider`; Stripe later | India-first. |
| Analytics | PostHog (self-host or cloud, EU/IN) | Funnels/retention built in; events in PRD §40. |
| Errors/observability | Sentry + OpenTelemetry + provider cost dashboards | |
| Testing | Vitest, Playwright, pgTAP for RLS | |
| CI/CD | GitHub Actions; preview deploys; migrations gated | |
| Hosting | Web on Vercel/Cloudflare; API on Fly.io/Render | Low ops cost. |

## 9. Major technical risks

1. **Food data quality & coverage (highest)** — Indian dishes vary hugely; nutrition errors destroy trust. Mitigate: curated seed, verification statuses, easy user correction, portion presets (katori/roti), never auto-trust AI.
2. **Safety/liability** — dangerous dieting, eating-disorder users, medical questions. Mitigate: calorie floors, rate caps, safety classifier, refusal policy, disclaimers, legal review.
3. **AI cost & latency** — Coach/scan costs vs. ₹299 ARPU. Mitigate: rules-first, caching, small models, quotas, usage monitoring.
4. **LLM numeric hallucination** — Mitigate: AI never calculates; numbers injected from engine; grounding validator; schema validation with deterministic fallback.
5. **Logging friction → churn** — The whole value depends on logged data. Mitigate: fast NL logging, recents/favourites, copy yesterday, early value from partial data.
6. **Health integrations** — Health Connect/HealthKit require native apps (no web API); Strava/Fitbit/Garmin need partner approval. Mitigate: web MVP is manual-only; plan thin native wrapper (Capacitor/React Native) for sync.
7. **Privacy/regulatory** — DPDP Act, health-data sensitivity, deletion completeness. Mitigate: consent ledger, minimisation, tested deletion, region choice.
8. **Scope vs. budget** — 30 acceptance criteria vs. ₹3–5 lakh. Mitigate: phase cut above; defer admin UI & billing.
9. **RLS mistakes** — silent cross-user leakage. Mitigate: automated per-table RLS tests in CI.
10. **Differentiation** — "what next" quality depends on sufficient history; cold-start days show weak advice. Mitigate: onboarding-derived priors, explicit "limited data" labelling, no fabricated insight.
11. **Time zones / day boundaries** — wrong day totals erode trust. Mitigate: store `local_date` + tz at write time.
12. **Brand/legal** — name not cleared (PRD §50); do not hard-code branding; use a config constant.

## 10. Questions to resolve before implementation

**Product**
1. Confirm **prototype scope**: OK to defer admin UI, Razorpay billing, voice, image scan, and integrations (manual only) in the first build? Feature gating via flags only?
2. Confirm **minimum age 18** and region of launch (India only at first?).
3. Is the "Daily Fitness Score" weighting in §0 acceptable, and should the user see the breakdown?
4. Calorie/rate safety limits (floors, 1%/week cap) — approve or specify your own?
5. Should users be able to turn AI features off entirely and still use the app? (Recommended: yes.)

**Data**
6. Food data: do you have a licensed/curated Indian food dataset, or should I build the seed from IFCT 2017 + manual curation? Who reviews (nutritionist)?
7. Units: metric only at launch (kg/cm) or also lb/ft?

**Technical**
8. Supabase confirmed? Preferred region (Mumbai vs. Singapore)?
9. Backend language: Node/TS (recommended) vs. Python?
10. LLM provider preference and monthly AI budget ceiling; which Anthropic/other API keys will you supply (I will not invent credentials)?
11. Hosting accounts (Vercel/Fly/Cloudflare) and analytics tool (PostHog OK?).
12. Native app timeline — is a Capacitor/React Native wrapper planned within 6 months (affects PWA vs. native-first decisions for health sync)?

**Business/legal**
13. Payment provider: Razorpay confirmed? GST invoicing needed from day one?
14. Legal: who drafts Privacy Policy/Terms/consent flows? Brand name for the prototype (placeholder "FitOS" until cleared)?
15. Repo: this repo (`kodemindstech/lovable`) is empty — use it as the monorepo root?

---

### Awaiting your approval
Reply with answers to §10 (or "use your defaults" and I will adopt the recommended choices marked above), and approve starting **Phase 1 — Foundation**.
