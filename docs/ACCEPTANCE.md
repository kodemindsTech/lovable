# MVP acceptance criteria (PRD §55) — honest status

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, but only verified against mocks/local Postgres (needs a live run) · ❌ not done.

| # | Criterion | Status | Evidence / gap |
|---|---|---|---|
| 1 | User can register | 🟡 | Supabase Auth sign-up UI; e2e renders form. Not run against real Auth |
| 2 | User can log in | 🟡 | Same |
| 3 | Complete onboarding | ✅ | `complete_onboarding` RPC (atomic, 18+) + e2e |
| 4 | Receives calculated targets | ✅ | Core engine tests + e2e (targets in RPC payload) |
| 5 | Log food | ✅ | DB `log_food` + e2e |
| 6 | Edit food | ✅ | DB `update_food_log_quantity` (UI edit not in e2e) |
| 7 | Delete food | ✅ | DB test; UI button (no confirm dialog) |
| 8–10 | Calories / protein / fibre correct | ✅ | DB totals tests, snapshot immutability |
| 11–13 | Log workouts, sets/reps/weights, history | ✅ | DB tests; e2e page smoke only |
| 14 | Log steps / activity | ✅ | DB tests |
| 15 | Log weight | ✅ | DB tests |
| 16 | Progress charts | ✅ | Core stats tests; chart renders in e2e |
| 17 | Daily Fitness Score | ✅ | Core tests (explanations, missing data excluded) |
| 18 | What Should I Do Now | ✅ | Core tests incl. PRD example, safety rules |
| 19 | AI Coach works | 🟡 | Pipeline, safety, fallbacks tested with a **stub model**; never run against a real LLM |
| 20 | Weekly report | ✅ | Core + data tests; AI narrative optional (stub-tested) |
| 21 | User data isolated | ✅ | Cross-user tests for every user table |
| 22 | RLS works | 🟡 | Verified on PGlite; verify on Supabase |
| 23 | Admin works | ✅/🟡 | Roles, audit, metrics tested in DB; UI e2e smoke only |
| 24 | Feature gating works | ✅/🟡 | AI gating server-enforced; score/reports/progression gated in UI only |
| 25 | Responsive | ✅ | e2e at 390px and 1280px, no overflow |
| 26 | Errors handled | ✅ | Error/retry/empty states, error boundary, safe API errors, e2e retry |
| 27 | AI estimates labelled | ✅ | "Estimate" chips; seed data marked `ai_estimated` |
| 28 | No fake data as real | ✅ | Nulls instead of zeros; no integrations faked; fake billing provider blocked in production |
| 29 | Secrets protected | ✅/🟡 | Scans + server-only keys; confirm in your deployment |
| 30 | Account deletion works | ✅ | DB cascade invariant + e2e UI |

**Beyond the criteria, before launch:** real Supabase run, real LLM review, real payment provider, nutritionist review of food data, legal review of Privacy/Terms and analytics consent, admin MFA, load test. See `LAUNCH_CHECKLIST.md`.
