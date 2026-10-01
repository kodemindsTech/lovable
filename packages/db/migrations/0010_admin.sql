-- Phase 9: role-based admin, audit triggers, feedback, announcements, feature flags, product analytics, admin metrics.
-- Principles: admins manage SHARED content and settings; they never get blanket access to users' health data.
-- Every admin write is audited by a DB trigger (cannot be skipped by the UI). First admin is bootstrapped by SQL.

-- ---------- roles ----------
create or replace function has_admin_role(variadic roles text[] default '{}') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid() and (role = 'super' or role = any(roles)));
$$;
create or replace function my_admin_role() returns text
language sql stable security definer set search_path = public as $$
  select role from admin_users where user_id = auth.uid();
$$;
revoke all on function has_admin_role(text[]) from public; grant execute on function has_admin_role(text[]) to anon, authenticated;   -- anon too: RLS policies on public tables evaluate it
revoke all on function my_admin_role() from public; grant execute on function my_admin_role() to authenticated;

-- Replace the blanket is_admin() policies with role-scoped ones.
drop policy admin_users_select on admin_users;  drop policy audit_select on audit_logs;  drop policy settings_write on app_settings;
drop policy cat_admin on food_categories;       drop policy foods_admin on foods;        drop policy ex_admin on exercises;
drop policy plans_admin on plans;               drop policy prices_admin on plan_prices; drop policy features_admin on plan_features;
drop policy subs_admin_select on subscriptions; drop policy subevents_admin on subscription_events;

create policy admin_users_select on admin_users for select using (user_id = auth.uid() or has_admin_role());
create policy admin_users_write on admin_users for all using (has_admin_role()) with check (has_admin_role());   -- super only (super is implicit)
create policy audit_select on audit_logs for select using (has_admin_role());
create policy settings_write on app_settings for all using (has_admin_role()) with check (has_admin_role());
create policy cat_admin on food_categories for all using (has_admin_role('content')) with check (has_admin_role('content'));
-- Admins edit the SHARED catalog only (owner_id is null); users' private foods/exercises stay private.
create policy foods_admin on foods for all using (owner_id is null and has_admin_role('content')) with check (owner_id is null and has_admin_role('content'));
create policy ex_admin on exercises for all using (owner_id is null and has_admin_role('content')) with check (owner_id is null and has_admin_role('content'));
create policy plans_admin on plans for all using (has_admin_role('finance')) with check (has_admin_role('finance'));
create policy prices_admin on plan_prices for all using (has_admin_role('finance')) with check (has_admin_role('finance'));
create policy features_admin on plan_features for all using (has_admin_role('finance')) with check (has_admin_role('finance'));
create policy subs_admin_select on subscriptions for select using (has_admin_role('finance','support'));
create policy subevents_admin on subscription_events for select using (has_admin_role('finance'));
-- Admins also need to see inactive plans/prices.
create policy plans_admin_read on plans for select using (has_admin_role('finance','content','support'));
create policy prices_admin_read on plan_prices for select using (has_admin_role('finance','content','support'));

-- The last super admin can't be removed or demoted (lock-out protection).
create or replace function protect_last_super() returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE' and old.role = 'super') or (tg_op = 'UPDATE' and old.role = 'super' and new.role <> 'super') then
    if (select count(*) from admin_users where role = 'super' and user_id <> old.user_id) = 0 then
      raise exception 'cannot remove the last super admin';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger admin_users_protect before update or delete on admin_users for each row execute function protect_last_super();

-- ---------- feature flags ----------
create table feature_flags (
  key text primary key,
  description text,
  enabled boolean not null default true,
  rollout_percent int not null default 100 check (rollout_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
alter table feature_flags enable row level security;
create policy flags_read on feature_flags for select to authenticated using (true);
create policy flags_admin on feature_flags for all using (has_admin_role()) with check (has_admin_role());
insert into feature_flags(key, description) values
  ('ai_coach', 'Kill switch: when off, the coach and report summaries answer from the rules engine only'),
  ('announcements', 'Show in-app announcements');

-- Deterministic per-user rollout: same user always lands in the same bucket for a given flag.
create or replace function my_flags() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(key, enabled and (abs(hashtextextended(auth.uid()::text || key, 0)) % 100) < rollout_percent), '{}'::jsonb)
  from feature_flags;
$$;

-- ---------- feedback ----------
create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug','idea','data_issue','other')),
  message text not null check (length(message) between 1 and 2000),
  page text,
  status text not null default 'new' check (status in ('new','reviewed','closed')),
  admin_note text,
  created_at timestamptz not null default now()
);
alter table feedback enable row level security;
create policy fb_insert on feedback for insert with check (user_id = auth.uid() and status = 'new' and admin_note is null);
create policy fb_select on feedback for select using (user_id = auth.uid());
create policy fb_admin_select on feedback for select using (has_admin_role('support', 'content'));
create policy fb_admin_update on feedback for update using (has_admin_role('support', 'content')) with check (has_admin_role('support', 'content'));

-- ---------- in-app notifications (announcements) ----------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 600),
  audience text not null default 'all' check (audience in ('all','free','paid')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table notification_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid not null references notifications(id) on delete cascade,
  primary key (user_id, notification_id)
);
alter table notifications enable row level security;
alter table notification_dismissals enable row level security;
create policy notif_read on notifications for select to authenticated using (
  active and starts_at <= now() and (ends_at is null or ends_at > now())
  and (audience = 'all' or (audience = 'paid' and effective_plan(auth.uid()) <> 'free') or (audience = 'free' and effective_plan(auth.uid()) = 'free')));
create policy notif_admin on notifications for all using (has_admin_role('content')) with check (has_admin_role('content'));
create policy dismiss_all on notification_dismissals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- product analytics (first-party, no health values) ----------
create table events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name in ('app_opened','signup','onboarding_started','onboarding_completed','food_logged','food_scan_started','food_scan_completed',
    'workout_started','workout_completed','weight_logged','activity_logged','ai_opened','ai_recommendation_viewed','ai_recommendation_followed',
    'weekly_report_viewed','subscription_started','subscription_cancelled')),
  created_at timestamptz not null default now()
);
create index on events(created_at, name);
create index on events(user_id, created_at);
alter table events enable row level security;
create policy events_insert on events for insert with check (user_id = auth.uid());
create policy events_select on events for select using (user_id = auth.uid());

-- Records an event unless the user has withdrawn analytics consent (default: allowed; confirm legal basis).
create or replace function track_event(p_name text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce((select granted from consents where user_id = auth.uid() and purpose = 'analytics' order by created_at desc, id desc limit 1), true) then
    insert into events(user_id, name) values (auth.uid(), p_name);
  end if;
end $$;

-- ---------- audit triggers ----------
create or replace function audit_admin_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb := to_jsonb(coalesce(new, old)); owner uuid := nullif(rec->>'owner_id','')::uuid;
begin
  if auth.uid() is not null and is_admin() and owner is null then   -- only admin edits of shared data
    insert into audit_logs(actor_id, action, target, meta)
      values (auth.uid(), tg_op, tg_table_name || ':' || coalesce(rec->>'id', rec->>'key', rec->>'user_id', ''),
              jsonb_build_object('old', case when tg_op <> 'INSERT' then to_jsonb(old) end, 'new', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  end if;
  return coalesce(new, old);
end $$;
create trigger audit_foods after insert or update or delete on foods for each row execute function audit_admin_change();
create trigger audit_exercises after insert or update or delete on exercises for each row execute function audit_admin_change();
create trigger audit_food_categories after insert or update or delete on food_categories for each row execute function audit_admin_change();
create trigger audit_plans after insert or update or delete on plans for each row execute function audit_admin_change();
create trigger audit_plan_prices after insert or update or delete on plan_prices for each row execute function audit_admin_change();
create trigger audit_plan_features after insert or update or delete on plan_features for each row execute function audit_admin_change();
create trigger audit_app_settings after insert or update or delete on app_settings for each row execute function audit_admin_change();
create trigger audit_feature_flags after insert or update or delete on feature_flags for each row execute function audit_admin_change();
create trigger audit_notifications after insert or update or delete on notifications for each row execute function audit_admin_change();
create trigger audit_admin_users after insert or update or delete on admin_users for each row execute function audit_admin_change();
create trigger audit_feedback after update on feedback for each row execute function audit_admin_change();
-- note: feedback has no owner_id column, so rec->>'owner_id' is null and admin updates are audited.

-- ---------- admin functions (role-checked inside; audited when they expose personal data) ----------
create or replace function admin_list_users(p_search text default null, p_limit int default 25, p_offset int default 0)
returns table(user_id uuid, email text, created_at timestamptz, onboarding_completed boolean, plan text, sub_status text)
language plpgsql security definer set search_path = public as $$
begin
  if not has_admin_role('support', 'finance') then raise exception 'forbidden'; end if;
  insert into audit_logs(actor_id, action, target, meta)
    values (auth.uid(), 'view_users', 'users', jsonb_build_object('search', p_search, 'limit', p_limit, 'offset', p_offset));
  return query
    select p.user_id, u.email::text, p.created_at, p.onboarding_completed, effective_plan(p.user_id), s.status
    from profiles p join auth.users u on u.id = p.user_id left join subscriptions s on s.user_id = p.user_id
    where p_search is null or p_search = '' or u.email ilike '%' || p_search || '%'
    order by p.created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function admin_add_admin(p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not has_admin_role() then raise exception 'forbidden'; end if;   -- super only
  if p_role not in ('support','content','finance','super') then raise exception 'invalid role'; end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'no such user'; end if;
  insert into admin_users(user_id, role) values (uid, p_role) on conflict (user_id) do update set role = excluded.role;
end $$;

-- Aggregate-only product metrics. No personal data. LTV/CAC need acquisition-cost data we don't have.
create or replace function admin_metrics(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; total int; paying int; mrr bigint; churned int;
begin
  if not has_admin_role('support', 'finance', 'content') then raise exception 'forbidden'; end if;
  select count(*) into total from profiles;
  select count(*) into paying from subscriptions s where effective_plan(s.user_id, p_now) <> 'free';
  select coalesce(sum(case sp.interval when 'year' then sp.amount_minor / 12 else sp.amount_minor end), 0) into mrr
    from subscriptions s join plan_prices sp on sp.plan_id = s.plan_id and sp.interval = s.interval and sp.currency = 'INR'
    where effective_plan(s.user_id, p_now) <> 'free' and s.status <> 'trialing';
  select count(*) into churned from subscriptions where status in ('canceled','expired') and last_event_at >= p_now - interval '30 days';
  r := jsonb_build_object(
    'total_users', total,
    'dau', (select count(distinct user_id) from events where created_at >= p_now - interval '1 day'),
    'wau', (select count(distinct user_id) from events where created_at >= p_now - interval '7 days'),
    'mau', (select count(distinct user_id) from events where created_at >= p_now - interval '30 days'),
    'retention', (select jsonb_object_agg('d' || n, case when cohort = 0 then null else round(100.0 * retained / cohort, 1) end)
       from (select n, count(*) as cohort, count(*) filter (where exists (
               select 1 from events e where e.user_id = p.user_id and e.created_at::date = p.created_at::date + n)) as retained
             from profiles p, (values (1),(7),(30)) v(n)
             where p.created_at::date + n <= p_now::date and p.created_at >= p_now - interval '90 days' group by n) x),
    'food_logs_30d', (select count(*) from food_logs where logged_at >= p_now - interval '30 days'),
    'users_logging_food_30d', (select count(distinct user_id) from food_logs where logged_at >= p_now - interval '30 days'),
    'workouts_completed_30d', (select count(*) from workout_sessions where completed and started_at >= p_now - interval '30 days'),
    'users_logging_workouts_30d', (select count(distinct user_id) from workout_sessions where completed and started_at >= p_now - interval '30 days'),
    'ai_requests_30d', (select count(*) from ai_usage where created_at >= p_now - interval '30 days'),
    'paying_users', paying,
    'ever_paid_users', (select count(*) from subscriptions),
    'conversion_pct', case when total = 0 then null else round(100.0 * (select count(*) from subscriptions) / total, 1) end,
    'churned_30d', churned,
    'monthly_churn_pct', case when churned + paying = 0 then null else round(100.0 * churned / (churned + paying), 1) end,
    'mrr_minor', mrr,
    'arpu_minor', case when total = 0 then null else mrr / total end,
    'arppu_minor', case when paying = 0 then null else mrr / paying end,
    'ltv_minor', null, 'cac_minor', null);
  return r;
end $$;

create or replace function admin_ai_stats(p_days int default 30, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_admin_role('support') then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'by_source', coalesce((select jsonb_object_agg(coalesce(source, 'user'), c) from (select source, count(*) c from ai_messages
        where role = 'assistant' and created_at >= p_now - make_interval(days => p_days) group by source) x), '{}'::jsonb),
    'safety_flagged', (select count(*) from ai_messages where safety_flag and created_at >= p_now - make_interval(days => p_days)),
    'conversations', (select count(*) from ai_conversations where created_at >= p_now - make_interval(days => p_days)),
    'requests_by_kind', coalesce((select jsonb_object_agg(kind, c) from (select kind, count(*) c from ai_usage
        where created_at >= p_now - make_interval(days => p_days) group by kind) y), '{}'::jsonb));
end $$;

-- Flagged exchanges for safety review. PSEUDONYMISED: no user id or email is returned. Access is audited.
create or replace function admin_flagged_messages(p_limit int default 25, p_before timestamptz default null)
returns table(message_id uuid, created_at timestamptz, source text, user_message text, reply text)
language plpgsql security definer set search_path = public as $$
begin
  if not has_admin_role('support') then raise exception 'forbidden'; end if;
  insert into audit_logs(actor_id, action, target, meta) values (auth.uid(), 'view_flagged_ai_messages', 'ai_messages', jsonb_build_object('limit', p_limit));
  return query
    select a.id, a.created_at, a.source,
           (select u.content from ai_messages u where u.conversation_id = a.conversation_id and u.role = 'user' and u.created_at <= a.created_at order by u.created_at desc limit 1),
           a.content
    from ai_messages a
    where a.role = 'assistant' and (a.safety_flag or a.source = 'safety') and (p_before is null or a.created_at < p_before)
    order by a.created_at desc limit least(greatest(p_limit, 1), 100);
end $$;
revoke all on function admin_list_users(text,int,int), admin_add_admin(text,text), admin_metrics(timestamptz), admin_ai_stats(int,timestamptz), admin_flagged_messages(int,timestamptz) from public;
grant execute on function admin_list_users(text,int,int), admin_add_admin(text,text), admin_metrics(timestamptz), admin_ai_stats(int,timestamptz), admin_flagged_messages(int,timestamptz) to authenticated;

-- A 'signup' analytics event is recorded server-side when the account is created.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id) values (new.id);
  insert into events(user_id, name) values (new.id, 'signup');
  return new;
end $$;
