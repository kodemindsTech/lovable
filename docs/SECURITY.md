# Security model & review (Phase 10)

Status: reviewed by the author of the code (not an independent audit). Get an external penetration test before handling real users' health data.

## Trust boundaries
| Boundary | Control |
|---|---|
| Browser → Supabase | Supabase Auth JWT; **every table has RLS** (checked by an automated test); anon key only in the client |
| Browser → API (`apps/api`) | Bearer JWT verified with Supabase; API then acts **as the user** (RLS applies) — no service key on user paths |
| Provider → API webhook | HMAC signature verified on the raw body; idempotent by provider event id; stale events ignored |
| API → LLM | Server-side key only; PII-free context; output validated (schema, safety, numeric grounding) |
| Admin | Role table + RLS + role checks inside DB functions; every admin edit audited by DB trigger; no blanket access to user health data |

## Secrets
- Never in the repo (scanned) or the web bundle. Server-only: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (billing webhook store only), billing webhook secret. See `apps/api/.env.example`.
- Errors and logs never include request bodies, tokens, keys or health data (tested).

## Automated checks (run in CI)
- All public tables have RLS; none has an always-true write policy; no RLS table lacks policies.
- Every `SECURITY DEFINER` function pins `search_path`.
- `anon` can execute only `has_admin_role` (needed by RLS policies); new functions are private by default; `apply_subscription_event` is service-role only.
- Cross-user isolation tests for every user-owned table; admin tests prove admins can't read user health rows.
- Account deletion cascades through every table referencing `auth.users` (invariant test).
- `pnpm audit --prod` clean (react-router upgraded to a patched major during this phase).
- API: security headers, safe 404/400/413/500 JSON, CORS allow-list, body size limits, rate limiting.

## Findings fixed in this phase
1. Any signed-in user could call `effective_plan(<other user id>)` and learn another user's plan → now restricted to self/admin/server.
2. Function `EXECUTE` was granted to `PUBLIC` by default (Postgres default) → revoked; default privileges changed.
3. `react-router` advisories (open redirect via `<Link>`, SSR deserialisation) → upgraded to v7.18+.
4. API returned framework error messages for malformed bodies → now generic JSON.

## Known risks / not covered
- **No real-Supabase run**: Auth flows, PostgREST behaviour and Supabase default privileges are assumed, not verified. Do this first.
- Tokens live in `localStorage` (Supabase default) → XSS would expose them. Mitigated by CSP in `apps/web/public/_headers` (must be adapted to your origins) and no `innerHTML`/`eval` usage; consider cookie-based sessions later.
- Admin MFA is not enforced by this code — enable it in Supabase Auth.
- Safety pre-check is a regex heuristic (English only). Needs expert review and monitoring.
- Users can insert their own analytics events and feedback without server-side rate limits; add limits before public launch.
- Daily score / reports / progression gating is client-side (UI gate); AI gating is server-enforced.
- In-memory API rate limiter is per instance.
- Billing: no real provider; webhook handling is tested with a fake HMAC provider only.
- Backups/PITR, secret rotation, incident response and data-retention policies are operational tasks (see `docs/LAUNCH_CHECKLIST.md`).
