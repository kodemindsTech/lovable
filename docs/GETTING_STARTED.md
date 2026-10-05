# Getting started with a real backend (about 15 minutes)

You need a free Supabase account. Nobody else can create it for you: it is tied to your login.

## 1. Create the project
1. Go to https://supabase.com → **Sign in** (GitHub or email) → **New project**.
2. Name it (e.g. `fitness-os`), choose a **region near your users** (Mumbai / Singapore), set a strong **database password** (save it in a password manager), click **Create**. Wait ~2 minutes.

## 2. Load the database
1. In the project, open **SQL Editor → New query**.
2. For each file in `packages/db/migrations/`, in order `0001` … `0011`: paste the contents, click **Run**. Each must finish with "Success". If one fails, stop and send me the error text.
3. Then run `packages/db/seed/foods.sql` and `packages/db/seed/exercises.sql`.

## 3. Connect the app
1. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
2. Create `apps/web/.env` (copy `apps/web/.env.example`) and fill:
   `VITE_SUPABASE_URL=...` and `VITE_SUPABASE_ANON_KEY=...`
3. `pnpm install && pnpm --filter @fitness-os/web dev`, open the printed URL, sign up, finish onboarding, log a meal.
4. **Authentication → URL Configuration**: add your app URL to the redirect list. For quick local testing you can turn off "Confirm email" under Authentication → Providers → Email (turn it back on before launch).

Do **not** share or commit the `service_role` key or the database password.

## 4. Make yourself an admin (optional)
After signing up once, in the SQL Editor run (replace the email):
```sql
insert into admin_users(user_id, role) select id, 'super' from auth.users where email = 'you@example.com';
```
Then reload the app; an **Admin** link appears. Turn on MFA for your Supabase account and admin users.

## 5. AI coach (optional)
Run the API (`apps/api`, see `.env.example`) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and optionally `ANTHROPIC_API_KEY` + `AI_MODEL`; set `VITE_API_URL` in the web `.env`. The coach needs a Pro plan: for testing, grant yourself one in the SQL Editor:
```sql
insert into subscriptions(user_id, plan_id, interval, status, current_period_end, last_event_at)
select id, 'pro', 'month', 'active', now() + interval '30 days', now() from auth.users where email = 'you@example.com'
on conflict (user_id) do update set status = 'active', current_period_end = excluded.current_period_end;
```

## What to tell me if something breaks
The exact error text and which step. Real-Supabase behaviour has not been tested yet, so first-run issues are expected and quick to fix.
