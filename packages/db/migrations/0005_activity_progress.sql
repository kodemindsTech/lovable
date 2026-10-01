-- Phase 4: activity, running, weight, body measurements, integration placeholders.
create type activity_type_t as enum ('steps','run','walk','cycle','other');

create table activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  type activity_type_t not null,
  steps int check (steps >= 0 and steps <= 200000),
  distance_km numeric check (distance_km > 0 and distance_km <= 1000),
  duration_min numeric check (duration_min > 0 and duration_min <= 1440),
  active_kcal int check (active_kcal >= 0 and active_kcal <= 20000),
  source text not null default 'manual',   -- 'manual' until a real integration exists
  notes text,
  logged_at timestamptz not null default now(),
  check (case type when 'steps' then steps is not null
                   else distance_km is not null or duration_min is not null end)
);
create unique index one_steps_per_day on activities(user_id, local_date) where type = 'steps';
create index on activities(user_id, local_date desc);

-- Run-only extras. Pace is derived from distance/duration, never stored or invented.
create table running_sessions (
  activity_id uuid primary key references activities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  avg_heart_rate int check (avg_heart_rate between 30 and 250)   -- null unless user/source provided
);

create table weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  weight_kg numeric not null check (weight_kg between 30 and 300),
  logged_at timestamptz not null default now(),
  unique (user_id, local_date)
);

create table body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  waist_cm numeric check (waist_cm between 20 and 300),
  chest_cm numeric check (chest_cm between 20 and 300),
  arms_cm numeric check (arms_cm between 10 and 100),
  hips_cm numeric check (hips_cm between 20 and 300),
  thighs_cm numeric check (thighs_cm between 10 and 200),
  body_fat_pct numeric check (body_fat_pct between 2 and 70),
  body_fat_source text not null default 'user_entered' check (body_fat_source in ('user_entered','imported')),
  created_at timestamptz not null default now(),
  unique (user_id, local_date),
  check (num_nonnulls(waist_cm, chest_cm, arms_cm, hips_cm, thighs_cm, body_fat_pct) > 0)
);

create table user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('health_connect','apple_health','strava','fitbit','garmin')),
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  connected_at timestamptz,
  unique (user_id, provider)
);

alter table activities enable row level security;
alter table running_sessions enable row level security;
alter table weight_logs enable row level security;
alter table body_measurements enable row level security;
alter table user_integrations enable row level security;

create policy act_all on activities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wl_all on weight_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bm_all on body_measurements for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ui_select on user_integrations for select using (user_id = auth.uid());
create policy ui_delete on user_integrations for delete using (user_id = auth.uid());
-- Connecting happens server-side (OAuth/sync) later; clients cannot self-assert "connected".

create policy run_select on running_sessions for select using (user_id = auth.uid());
create policy run_insert on running_sessions for insert with check (user_id = auth.uid()
  and exists (select 1 from activities a where a.id = activity_id and a.user_id = auth.uid() and a.type = 'run'));
create policy run_update on running_sessions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy run_delete on running_sessions for delete using (user_id = auth.uid());

-- One steps entry per day; re-entering replaces it (manual source only).
create or replace function set_steps(p_date date, p_steps int) returns activities
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); r activities;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into activities(user_id, local_date, type, steps) values (uid, p_date, 'steps', p_steps)
    on conflict (user_id, local_date) where type = 'steps'
    do update set steps = excluded.steps, source = 'manual', logged_at = now()
    returning * into r;
  return r;
end $$;

create or replace function log_run(p_date date, p_distance_km numeric, p_duration_min numeric,
                                   p_active_kcal int default null, p_avg_hr int default null)
returns activities language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); r activities;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into activities(user_id, local_date, type, distance_km, duration_min, active_kcal)
    values (uid, p_date, 'run', p_distance_km, p_duration_min, p_active_kcal) returning * into r;
  insert into running_sessions(activity_id, user_id, avg_heart_rate) values (r.id, uid, p_avg_hr);
  return r;
end $$;

create or replace function set_weight(p_date date, p_kg numeric) returns weight_logs
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); r weight_logs;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into weight_logs(user_id, local_date, weight_kg) values (uid, p_date, p_kg)
    on conflict (user_id, local_date) do update set weight_kg = excluded.weight_kg, logged_at = now()
    returning * into r;
  return r;
end $$;
