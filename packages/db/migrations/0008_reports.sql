-- Phase 7: weekly report cache, TDEE on targets (for the estimated energy balance), report AI quota.
alter table nutrition_targets add column tdee int;

create table weekly_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  report jsonb not null,               -- deterministic report (derived; recomputable)
  narrative jsonb,                     -- optional AI/rules narrative, with its source
  generated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table weekly_reports enable row level security;
create policy wr_all on weekly_reports for all using (user_id = auth.uid()) with check (user_id = auth.uid());

update app_settings set value = value || '{"report_daily": 10}'::jsonb where key = 'ai_quota';

-- Re-declared to also persist tdee (see 0002).
create or replace function complete_onboarding(p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (p->>'age')::int < 18 then raise exception 'must be 18 or older'; end if;

  insert into consents(user_id, purpose, granted, policy_version)
    values (uid, 'health_data', true, coalesce(p->>'policy_version', 'draft-1'));

  update goals set active = false where user_id = uid and active;
  insert into goals(user_id, goal, start_weight_kg, target_weight_kg)
    values (uid, (p->>'goal')::goal_t, (p->>'weight_kg')::numeric, nullif(p->>'target_weight_kg','')::numeric);

  insert into nutrition_targets(user_id, calories, protein_g, carbs_g, fat_g, fibre_g, steps, tdee, formula_version)
    values (uid, (p->'targets'->>'calories')::int, (p->'targets'->>'protein_g')::int, (p->'targets'->>'carbs_g')::int,
            (p->'targets'->>'fat_g')::int, (p->'targets'->>'fibre_g')::int, (p->'targets'->>'steps')::int,
            nullif(p->'targets'->>'tdee','')::int, p->'targets'->>'formula_version')
    on conflict (user_id) do update set calories = excluded.calories, protein_g = excluded.protein_g,
      carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fibre_g = excluded.fibre_g, steps = excluded.steps,
      tdee = excluded.tdee, formula_version = excluded.formula_version, is_manual_override = false, updated_at = now();

  insert into target_history(user_id, calories, protein_g, carbs_g, fat_g, fibre_g, steps, formula_version, inputs)
    values (uid, (p->'targets'->>'calories')::int, (p->'targets'->>'protein_g')::int, (p->'targets'->>'carbs_g')::int,
            (p->'targets'->>'fat_g')::int, (p->'targets'->>'fibre_g')::int, (p->'targets'->>'steps')::int,
            p->'targets'->>'formula_version', p->'inputs');

  update profiles set
    name = nullif(p->>'name',''), birth_date = (current_date - ((p->>'age')::int * 365.25)::int),
    sex = (p->>'sex')::sex_t, height_cm = (p->>'height_cm')::numeric, activity_level = (p->>'activity_level')::activity_level_t,
    diet = (p->>'diet')::diet_t, training_days_per_week = (p->>'training_days')::smallint, onboarding_completed = true
  where user_id = uid;
  if not found then raise exception 'profile missing'; end if;
end $$;
