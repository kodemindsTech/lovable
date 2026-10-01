# Deployment

Nothing here has been run against real infrastructure yet — treat as a checklist to execute and correct.

## 1. Supabase
1. Create a project (region close to users, e.g. Mumbai/Singapore). Enable **MFA** for dashboard/admin users and set auth redirect URLs.
2. Apply migrations: `pnpm supabase:prepare` then `supabase db push` (or run `packages/db/migrations/*.sql` in order), then the seeds in `packages/db/seed/`.
3. Bootstrap the first admin: `insert into admin_users(user_id, role) values ('<auth user id>', 'super');`
4. Check Settings → API: only the **anon** key goes to the web app. Confirm "Exposed schemas" = `public` and that the function-privilege invariants hold (run the queries in `packages/db/test/hardening.test.ts` against the project).
5. Enable daily backups / PITR. Set email provider + templates, password policy and rate limits.

## 2. API (`apps/api`)
- Build: `docker build -f apps/api/Dockerfile -t fitness-os-api .` (or run `pnpm --filter @fitness-os/api start` on any Node 22 host: Fly.io, Render, Cloud Run).
- Env (see `apps/api/.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGINS` (required in production), optional `ANTHROPIC_API_KEY` + `AI_MODEL`, billing vars when a real provider exists. `NODE_ENV=production`.
- Health check: `GET /healthz`. Terminate TLS at the platform. Run ≥2 instances only after replacing the in-memory rate limiter.
- The service-role key is needed only if billing webhooks are enabled; store it in the platform's secret manager.

## 3. Web (`apps/web`)
- Build: `VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… VITE_API_URL=… pnpm --filter @fitness-os/web build` → static `dist/`.
- Host on Cloudflare Pages / Netlify / Vercel. `public/_headers` (CSP etc.) and `_redirects` (SPA fallback) are Netlify/Cloudflare-style — **edit the CSP `connect-src` placeholders** to your Supabase and API origins; replicate in `vercel.json` if using Vercel.

## 4. Payments (not implemented)
Implement `BillingProvider` for your provider (e.g. Razorpay Subscriptions), map its webhooks to `BillingEvent`s, set `BILLING_PROVIDER`, and test end-to-end in the provider's sandbox before any live charge. Set `plan_prices.provider_price_id`.

## 5. Observability (to add)
Error tracking (Sentry), uptime checks on `/healthz`, log shipping (API logs are JSON, metadata only), alerts on 5xx rate and AI fallback rate (`coach_reply` events with `fallback`), provider cost dashboards.

## 6. Rollback
Web/API: redeploy previous build. Database: migrations are forward-only; write a compensating migration. Keep PITR enabled before every migration.
