-- Phase 8: plans, prices, features, subscriptions, entitlements.
-- Prices/limits/features live in tables (admin-editable) — nothing is hard-coded in application code.
-- No card data is stored; the payment provider holds it. Subscription rows are written only by the server.

create table plans (
  id text primary key check (id in ('free','pro','pro_plus')),
  name text not null,
  sort int not null,
  active boolean not null default true
);
create table plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references plans(id),
  interval text not null check (interval in ('month','year')),
  currency text not null default 'INR',
  amount_minor int not null check (amount_minor > 0),   -- e.g. paise
  active boolean not null default true,
  provider_price_id text,                                -- id of the price at the payment provider
  unique (plan_id, interval, currency)
);
create table plan_features (
  plan_id text not null references plans(id),
  feature_key text not null,
  daily_limit int check (daily_limit > 0),               -- for metered (AI) features; null = not metered
  primary key (plan_id, feature_key)
);

create table subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('pro','pro_plus')) references plans(id),
  interval text not null check (interval in ('month','year')),
  status text not null check (status in ('trialing','active','past_due','canceled','expired')),
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  pending_plan_id text references plans(id),
  pending_interval text check (pending_interval in ('month','year')),
  last_event_at timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  had_trial boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated before update on subscriptions for each row execute function set_updated_at();

create table subscription_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,  -- retention of billing records after deletion: confirm with legal
  provider text not null,
  provider_event_id text not null,
  type text not null,
  occurred_at timestamptz not null,
  payload jsonb,
  outcome text not null,                                              -- applied | ignored | no_state
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)                                -- idempotency
);

alter table plans enable row level security;
alter table plan_prices enable row level security;
alter table plan_features enable row level security;
alter table subscriptions enable row level security;
alter table subscription_events enable row level security;

create policy plans_read on plans for select to anon, authenticated using (active);
create policy plans_admin on plans for all using (is_admin()) with check (is_admin());
create policy prices_read on plan_prices for select to anon, authenticated using (active);
create policy prices_admin on plan_prices for all using (is_admin()) with check (is_admin());
create policy features_read on plan_features for select to anon, authenticated using (true);
create policy features_admin on plan_features for all using (is_admin()) with check (is_admin());
create policy subs_select on subscriptions for select using (user_id = auth.uid());
create policy subs_admin_select on subscriptions for select using (is_admin());
create policy subevents_admin on subscription_events for select using (is_admin());
-- (no insert/update/delete policies on subscriptions or events: only apply_subscription_event() writes them)

insert into app_settings(key, value) values ('billing', '{"grace_days":7,"trial_days":7,"period_skew_hours":12}') on conflict (key) do nothing;

-- Seed: PRD §32 target-test pricing (INR, minor units). Change in the tables, not in code.
insert into plans(id, name, sort) values ('free','Free',0),('pro','Pro',1),('pro_plus','Pro+',2);
insert into plan_prices(plan_id, interval, currency, amount_minor) values
  ('pro','month','INR',29900), ('pro','year','INR',199900), ('pro_plus','month','INR',49900);
insert into plan_features(plan_id, feature_key, daily_limit) values
  ('pro','ai_coach',20), ('pro','weekly_reports',10), ('pro','ai_food_recognition',null), ('pro','voice_logging',null),
  ('pro','daily_fitness_score',null), ('pro','advanced_analytics',null), ('pro','workout_progression',null),
  ('pro_plus','ai_coach',60), ('pro_plus','weekly_reports',30), ('pro_plus','ai_food_recognition',null), ('pro_plus','voice_logging',null),
  ('pro_plus','daily_fitness_score',null), ('pro_plus','advanced_analytics',null), ('pro_plus','workout_progression',null),
  ('pro_plus','advanced_ai_coaching',null), ('pro_plus','ai_meal_planning',null), ('pro_plus','running_analysis',null),
  ('pro_plus','advanced_progress',null), ('pro_plus','advanced_recommendations',null);

-- Plan whose features a user may use at `p_now`. Mirrors effectivePlan() in packages/core/src/billing.ts.
create or replace function effective_plan(p_user uuid, p_now timestamptz default now()) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case s.status
      when 'trialing' then case when s.trial_end > p_now then s.plan_id end
      when 'active'   then case when s.current_period_end + make_interval(hours => coalesce((select (value->>'period_skew_hours')::int from app_settings where key='billing'), 12)) > p_now then s.plan_id end
      when 'past_due' then case when s.grace_until > p_now then s.plan_id end
    end
    from subscriptions s where s.user_id = p_user), 'free');
$$;
revoke all on function effective_plan(uuid, timestamptz) from public;
grant execute on function effective_plan(uuid, timestamptz) to authenticated, service_role;

create or replace function current_entitlements() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare uid uuid := auth.uid(); plan text; sub subscriptions; trial_days int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  plan := effective_plan(uid);
  select * into sub from subscriptions where user_id = uid;
  select coalesce((value->>'trial_days')::int, 0) into trial_days from app_settings where key = 'billing';
  return jsonb_build_object(
    'plan', plan,
    'features', coalesce((select jsonb_agg(feature_key order by feature_key) from plan_features where plan_id = plan), '[]'::jsonb),
    'subscription', case when sub.user_id is null then null else jsonb_build_object(
      'plan_id', sub.plan_id, 'interval', sub.interval, 'status', sub.status, 'current_period_end', sub.current_period_end,
      'trial_end', sub.trial_end, 'cancel_at_period_end', sub.cancel_at_period_end, 'grace_until', sub.grace_until,
      'pending_plan_id', sub.pending_plan_id) end,
    'trial_eligible', coalesce(trial_days, 0) > 0 and not coalesce(sub.had_trial, false)
  );
end $$;

-- Feature gate + daily quota for AI calls. Fails closed. Limits come from plan_features.
create or replace function ai_consume(p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); plan text; feat text; lim int; used int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  feat := case p_kind when 'coach' then 'ai_coach' when 'report' then 'weekly_reports' else null end;
  if feat is null then raise exception 'ai_quota_not_configured'; end if;
  plan := effective_plan(uid);
  select daily_limit into lim from plan_features where plan_id = plan and feature_key = feat;
  if not found then raise exception 'feature_not_in_plan'; end if;
  if lim is null then raise exception 'ai_quota_not_configured'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_kind, 0));
  select count(*) into used from ai_usage
    where user_id = uid and kind = p_kind and created_at >= date_trunc('day', now() at time zone 'utc');
  if used >= lim then raise exception 'quota_exceeded'; end if;
  insert into ai_usage(user_id, kind) values (uid, p_kind);
  return lim - used - 1;
end $$;

-- Server-only: records a provider event (idempotent) and stores the already-computed subscription state.
create or replace function apply_subscription_event(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := (p->>'user_id')::uuid; st jsonb := p->'state'; n int; cur timestamptz; outcome text;
begin
  select last_event_at into cur from subscriptions where user_id = uid;
  outcome := case when st is null or st = 'null'::jsonb then 'no_state'
                  when cur is not null and cur > (st->>'last_event_at')::timestamptz then 'ignored' else 'applied' end;
  insert into subscription_events(user_id, provider, provider_event_id, type, occurred_at, payload, outcome)
    values (uid, p->>'provider', p->>'provider_event_id', p->>'type', (p->>'occurred_at')::timestamptz, p->'payload', outcome)
    on conflict (provider, provider_event_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if;
  if outcome = 'applied' then
    insert into subscriptions(user_id, plan_id, interval, status, current_period_end, trial_end, cancel_at_period_end, grace_until,
        pending_plan_id, pending_interval, last_event_at, provider, provider_customer_id, provider_subscription_id, had_trial)
      values (uid, st->>'plan_id', st->>'interval', st->>'status', (st->>'current_period_end')::timestamptz, (st->>'trial_end')::timestamptz,
        coalesce((st->>'cancel_at_period_end')::boolean, false), (st->>'grace_until')::timestamptz, st->>'pending_plan_id', st->>'pending_interval',
        (st->>'last_event_at')::timestamptz, p->>'provider', st->>'provider_customer_id', st->>'provider_subscription_id', (st->>'trial_end') is not null)
    on conflict (user_id) do update set plan_id = excluded.plan_id, interval = excluded.interval, status = excluded.status,
        current_period_end = excluded.current_period_end, trial_end = excluded.trial_end, cancel_at_period_end = excluded.cancel_at_period_end,
        grace_until = excluded.grace_until, pending_plan_id = excluded.pending_plan_id, pending_interval = excluded.pending_interval,
        last_event_at = excluded.last_event_at, provider = excluded.provider,
        provider_customer_id = coalesce(excluded.provider_customer_id, subscriptions.provider_customer_id),
        provider_subscription_id = coalesce(excluded.provider_subscription_id, subscriptions.provider_subscription_id),
        had_trial = subscriptions.had_trial or excluded.had_trial;
  end if;
  return outcome;
end $$;
revoke all on function apply_subscription_event(jsonb) from public;
grant execute on function apply_subscription_event(jsonb) to service_role;

update app_settings set value = value - 'coach_daily' - 'report_daily' where key = 'ai_quota';
