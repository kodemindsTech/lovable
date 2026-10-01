-- Phase 2: nutrition. Foods catalog, meal/food logs, water, search, day totals.
create extension if not exists pg_trgm;

create type verification_t as enum ('verified','user_entered','ai_estimated','admin_reviewed');
create type meal_t as enum ('breakfast','lunch','dinner','snack');

create table food_categories (
  id serial primary key,
  name text not null unique
);

-- All nutrition values are PER SERVING (serving_size serving_unit).
create table foods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade, -- null = shared catalog
  name text not null,
  aliases text[] not null default '{}',
  brand text,
  category_id int references food_categories(id),
  cuisine text,
  serving_size numeric not null check (serving_size > 0),
  serving_unit text not null,
  serving_grams numeric check (serving_grams > 0),
  calories numeric not null check (calories >= 0),
  protein_g numeric not null check (protein_g >= 0),
  carbs_g numeric not null check (carbs_g >= 0),
  fat_g numeric not null check (fat_g >= 0),
  fibre_g numeric not null check (fibre_g >= 0),
  source text not null,
  verification_status verification_t not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- user foods can only ever be 'user_entered'; statuses are never mixed.
  check (owner_id is null or verification_status = 'user_entered')
);
create trigger foods_updated before update on foods for each row execute function set_updated_at();
create index foods_name_trgm on foods using gin (name gin_trgm_ops);

create table meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  meal_type meal_t not null,
  unique (user_id, local_date, meal_type)
);

-- Totals are a SNAPSHOT so later catalog edits never rewrite history.
create table food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_log_id uuid not null references meal_logs(id) on delete cascade,
  food_id uuid references foods(id) on delete set null,
  name text not null,
  quantity numeric not null check (quantity > 0),     -- number of servings
  serving_label text not null,                          -- e.g. '1 katori'
  calories numeric not null check (calories >= 0),
  protein_g numeric not null check (protein_g >= 0),
  carbs_g numeric not null check (carbs_g >= 0),
  fat_g numeric not null check (fat_g >= 0),
  fibre_g numeric not null check (fibre_g >= 0),
  source_status verification_t not null,
  logged_at timestamptz not null default now()
);
create index food_logs_meal on food_logs(meal_log_id);
create index food_logs_user_time on food_logs(user_id, logged_at);

create table water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  ml int not null check (ml > 0 and ml <= 5000),
  logged_at timestamptz not null default now()
);
create index water_user_date on water_logs(user_id, local_date);

alter table food_categories enable row level security;
alter table foods enable row level security;
alter table meal_logs enable row level security;
alter table food_logs enable row level security;
alter table water_logs enable row level security;

create policy cat_select on food_categories for select to authenticated using (true);
create policy cat_admin on food_categories for all using (is_admin()) with check (is_admin());

create policy foods_select on foods for select to authenticated using (owner_id is null or owner_id = auth.uid());
create policy foods_insert on foods for insert with check (owner_id = auth.uid() and verification_status = 'user_entered');
create policy foods_update on foods for update using (owner_id = auth.uid()) with check (owner_id = auth.uid() and verification_status = 'user_entered');
create policy foods_delete on foods for delete using (owner_id = auth.uid());
create policy foods_admin on foods for all using (is_admin()) with check (is_admin());

create policy meals_all on meal_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy flogs_select on food_logs for select using (user_id = auth.uid());
create policy flogs_insert on food_logs for insert with check (
  user_id = auth.uid() and exists (select 1 from meal_logs m where m.id = meal_log_id and m.user_id = auth.uid()));
create policy flogs_update on food_logs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy flogs_delete on food_logs for delete using (user_id = auth.uid());
create policy water_all on water_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Search: prefix > substring/alias > fuzzy. Visible rows only (RLS applies: invoker).
create or replace function search_foods(q text, lim int default 20) returns setof foods
language sql stable security invoker set search_path = public as $$
  select f.* from foods f
  where length(trim(q)) > 0 and (
    f.name ilike '%' || trim(q) || '%'
    or exists (select 1 from unnest(f.aliases) a where a ilike '%' || trim(q) || '%')
    or similarity(f.name, trim(q)) > 0.3)
  order by (f.name ilike trim(q) || '%') desc,
           (f.name ilike '%' || trim(q) || '%') desc,
           similarity(f.name, trim(q)) desc, f.name
  limit least(greatest(lim, 1), 50);
$$;

-- Server-authoritative logging: snapshot is computed from the catalog row, not the client.
create or replace function log_food(p_food_id uuid, p_date date, p_meal meal_t, p_quantity numeric)
returns food_logs language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); f foods; m uuid; r food_logs;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be positive'; end if;
  select * into f from foods where id = p_food_id;  -- RLS limits to visible foods
  if not found then raise exception 'food not found'; end if;
  insert into meal_logs(user_id, local_date, meal_type) values (uid, p_date, p_meal)
    on conflict (user_id, local_date, meal_type) do update set meal_type = excluded.meal_type
    returning id into m;
  insert into food_logs(user_id, meal_log_id, food_id, name, quantity, serving_label,
      calories, protein_g, carbs_g, fat_g, fibre_g, source_status)
    values (uid, m, f.id, f.name, p_quantity, f.serving_size::text || ' ' || f.serving_unit,
      f.calories * p_quantity, f.protein_g * p_quantity, f.carbs_g * p_quantity,
      f.fat_g * p_quantity, f.fibre_g * p_quantity, f.verification_status)
    returning * into r;
  return r;
end $$;

-- Editing quantity rescales the snapshot proportionally.
create or replace function update_food_log_quantity(p_id uuid, p_quantity numeric)
returns food_logs language plpgsql security invoker set search_path = public as $$
declare r food_logs;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be positive'; end if;
  update food_logs set
    calories = calories / quantity * p_quantity, protein_g = protein_g / quantity * p_quantity,
    carbs_g = carbs_g / quantity * p_quantity, fat_g = fat_g / quantity * p_quantity,
    fibre_g = fibre_g / quantity * p_quantity, quantity = p_quantity
  where id = p_id and user_id = auth.uid() returning * into r;
  if not found then raise exception 'log not found'; end if;
  return r;
end $$;

create or replace function day_totals(p_date date)
returns table(calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fibre_g numeric, water_ml bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(fl.calories),0), coalesce(sum(fl.protein_g),0), coalesce(sum(fl.carbs_g),0),
         coalesce(sum(fl.fat_g),0), coalesce(sum(fl.fibre_g),0),
         (select coalesce(sum(ml),0) from water_logs w where w.user_id = auth.uid() and w.local_date = p_date)
  from food_logs fl join meal_logs ml on ml.id = fl.meal_log_id
  where fl.user_id = auth.uid() and ml.local_date = p_date;
$$;
