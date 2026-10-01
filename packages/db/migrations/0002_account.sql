-- Atomic onboarding + account deletion. Both run with the caller's identity.

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
    values (uid, (p->>'goal')::goal_t, (p->>'weight_kg')::numeric,
            nullif(p->>'target_weight_kg','')::numeric);

  insert into nutrition_targets(user_id, calories, protein_g, carbs_g, fat_g, fibre_g, steps, formula_version)
    values (uid, (p->'targets'->>'calories')::int, (p->'targets'->>'protein_g')::int,
            (p->'targets'->>'carbs_g')::int, (p->'targets'->>'fat_g')::int,
            (p->'targets'->>'fibre_g')::int, (p->'targets'->>'steps')::int,
            p->'targets'->>'formula_version')
    on conflict (user_id) do update set calories = excluded.calories, protein_g = excluded.protein_g,
      carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fibre_g = excluded.fibre_g,
      steps = excluded.steps, formula_version = excluded.formula_version,
      is_manual_override = false, updated_at = now();

  insert into target_history(user_id, calories, protein_g, carbs_g, fat_g, fibre_g, steps, formula_version, inputs)
    values (uid, (p->'targets'->>'calories')::int, (p->'targets'->>'protein_g')::int,
            (p->'targets'->>'carbs_g')::int, (p->'targets'->>'fat_g')::int,
            (p->'targets'->>'fibre_g')::int, (p->'targets'->>'steps')::int,
            p->'targets'->>'formula_version', p->'inputs');

  update profiles set
    name = nullif(p->>'name',''),
    birth_date = (current_date - ((p->>'age')::int * 365.25)::int),
    sex = (p->>'sex')::sex_t,
    height_cm = (p->>'height_cm')::numeric,
    activity_level = (p->>'activity_level')::activity_level_t,
    diet = (p->>'diet')::diet_t,
    training_days_per_week = (p->>'training_days')::smallint,
    onboarding_completed = true
  where user_id = uid;
  if not found then raise exception 'profile missing'; end if;
end $$;

-- Hard-deletes the caller's account. auth.users cascades to every user-owned table.
create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into audit_logs(actor_id, action, target) values (null, 'account_deleted', 'user');
  delete from auth.users where id = uid;
end $$;
revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;
