-- Phase 1 foundation: profiles, goals, targets, consents, admin, settings.
-- Every user-owned table has RLS enabled with explicit per-operation policies.

create type sex_t as enum ('male','female');
create type goal_t as enum ('lose_weight','lose_fat','maintain','build_muscle','gain_weight','improve_fitness','improve_running');
create type activity_level_t as enum ('sedentary','light','moderate','very_active','extremely_active');
create type diet_t as enum ('vegetarian','eggetarian','non_vegetarian','vegan','other');

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('support','content','finance','super')),
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  birth_date date,
  sex sex_t,
  height_cm numeric(5,1) check (height_cm between 120 and 230),
  activity_level activity_level_t,
  training_days_per_week smallint check (training_days_per_week between 0 and 7),
  workout_type text,
  diet diet_t,
  cuisine text,
  timezone text not null default 'Asia/Kolkata',
  units text not null default 'metric' check (units in ('metric','imperial')),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal goal_t not null,
  start_weight_kg numeric(5,1) not null check (start_weight_kg between 30 and 300),
  target_weight_kg numeric(5,1) check (target_weight_kg between 30 and 300),
  target_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index goals_one_active on goals(user_id) where active;

create table nutrition_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calories int not null, protein_g int not null, carbs_g int not null,
  fat_g int not null, fibre_g int not null, steps int not null,
  is_manual_override boolean not null default false,
  formula_version text not null,
  updated_at timestamptz not null default now()
);

create table target_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calories int not null, protein_g int not null, carbs_g int not null,
  fat_g int not null, fibre_g int not null, steps int not null,
  is_manual_override boolean not null default false,
  formula_version text not null,
  inputs jsonb not null,
  created_at timestamptz not null default now()
);
create index on target_history(user_id, created_at desc);

create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null, -- 'terms','privacy','health_data','ai_processing','marketing'
  granted boolean not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- Auto-create an empty profile on signup.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into profiles(user_id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ===== RLS =====
alter table admin_users enable row level security;
alter table profiles enable row level security;
alter table goals enable row level security;
alter table nutrition_targets enable row level security;
alter table target_history enable row level security;
alter table consents enable row level security;
alter table app_settings enable row level security;
alter table audit_logs enable row level security;

-- profiles
create policy profiles_select on profiles for select using (user_id = auth.uid());
create policy profiles_update on profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_delete on profiles for delete using (user_id = auth.uid());

-- goals / targets / history: owner full CRUD
create policy goals_select on goals for select using (user_id = auth.uid());
create policy goals_insert on goals for insert with check (user_id = auth.uid());
create policy goals_update on goals for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy goals_delete on goals for delete using (user_id = auth.uid());

create policy targets_select on nutrition_targets for select using (user_id = auth.uid());
create policy targets_insert on nutrition_targets for insert with check (user_id = auth.uid());
create policy targets_update on nutrition_targets for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy targets_delete on nutrition_targets for delete using (user_id = auth.uid());

create policy thist_select on target_history for select using (user_id = auth.uid());
create policy thist_insert on target_history for insert with check (user_id = auth.uid());
create policy thist_delete on target_history for delete using (user_id = auth.uid());

-- consents: append-only for the user
create policy consents_select on consents for select using (user_id = auth.uid());
create policy consents_insert on consents for insert with check (user_id = auth.uid());

-- app_settings: readable by signed-in users, writable by admins
create policy settings_select on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for all using (is_admin()) with check (is_admin());

-- admin tables: admin read only; writes via service role
create policy admin_users_select on admin_users for select using (is_admin());
create policy audit_select on audit_logs for select using (is_admin());
