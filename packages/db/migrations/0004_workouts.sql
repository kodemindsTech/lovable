-- Phase 3: exercises, sessions, sets, templates. History/PRs are derived (no denormalised copy to go stale).
create type difficulty_t as enum ('beginner','intermediate','advanced');

create table exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,  -- null = shared catalog
  name text not null,
  muscle_group text not null,
  equipment text not null,
  difficulty difficulty_t not null default 'beginner',
  instructions text,
  tracks text not null default 'weight_reps' check (tracks in ('weight_reps','reps','duration')),
  created_at timestamptz not null default now()
);
create index exercises_name_trgm on exercises using gin (name gin_trgm_ops);

create table workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  workout_name text not null,
  duration_min int check (duration_min between 0 and 1440),
  notes text,
  completed boolean not null default false,
  started_at timestamptz not null default now()
);
create index on workout_sessions(user_id, local_date desc);

create table session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references workout_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  position int not null default 0,
  unique (session_id, exercise_id)
);

create table workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references workout_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  set_number int not null check (set_number > 0),
  weight_kg numeric check (weight_kg >= 0 and weight_kg <= 1000),
  reps int check (reps > 0 and reps <= 1000),
  duration_s int check (duration_s > 0 and duration_s <= 86400),
  notes text,
  created_at timestamptz not null default now(),
  check (reps is not null or duration_s is not null)
);
create index on workout_sets(user_id, exercise_id);
create index on workout_sets(session_id);

create table workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table template_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references workout_templates(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  position int not null default 0,
  unique (template_id, exercise_id)
);

alter table exercises enable row level security;
alter table workout_sessions enable row level security;
alter table session_exercises enable row level security;
alter table workout_sets enable row level security;
alter table workout_templates enable row level security;
alter table template_exercises enable row level security;

create policy ex_select on exercises for select to authenticated using (owner_id is null or owner_id = auth.uid());
create policy ex_insert on exercises for insert with check (owner_id = auth.uid());
create policy ex_update on exercises for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ex_delete on exercises for delete using (owner_id = auth.uid());
create policy ex_admin on exercises for all using (is_admin()) with check (is_admin());

create policy sess_all on workout_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tpl_all on workout_templates for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child rows: owner AND the parent session/template must also belong to the caller.
create policy sx_select on session_exercises for select using (user_id = auth.uid());
create policy sx_insert on session_exercises for insert with check (user_id = auth.uid()
  and exists (select 1 from workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy sx_update on session_exercises for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sx_delete on session_exercises for delete using (user_id = auth.uid());

create policy ws_select on workout_sets for select using (user_id = auth.uid());
create policy ws_insert on workout_sets for insert with check (user_id = auth.uid()
  and exists (select 1 from workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy ws_update on workout_sets for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ws_delete on workout_sets for delete using (user_id = auth.uid());

create policy tx_select on template_exercises for select using (user_id = auth.uid());
create policy tx_insert on template_exercises for insert with check (user_id = auth.uid()
  and exists (select 1 from workout_templates t where t.id = template_id and t.user_id = auth.uid()));
create policy tx_update on template_exercises for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tx_delete on template_exercises for delete using (user_id = auth.uid());

create or replace function search_exercises(q text, lim int default 20) returns setof exercises
language sql stable security invoker set search_path = public as $$
  select e.* from exercises e
  where length(trim(q)) > 0 and (e.name ilike '%' || trim(q) || '%' or e.muscle_group ilike trim(q) || '%'
        or similarity(e.name, trim(q)) > 0.3)
  order by (e.name ilike trim(q) || '%') desc, similarity(e.name, trim(q)) desc, e.name
  limit least(greatest(lim, 1), 50);
$$;

-- Starts a session, optionally pre-filled from a template.
create or replace function start_session(p_date date, p_name text, p_template uuid default null)
returns workout_sessions language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); s workout_sessions;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into workout_sessions(user_id, local_date, workout_name)
    values (uid, p_date, coalesce(nullif(trim(p_name), ''), 'Workout')) returning * into s;
  if p_template is not null then
    if not exists (select 1 from workout_templates where id = p_template and user_id = uid) then
      raise exception 'template not found'; end if;
    insert into session_exercises(user_id, session_id, exercise_id, position)
      select uid, s.id, exercise_id, position from template_exercises where template_id = p_template;
  end if;
  return s;
end $$;

create or replace function save_template_from_session(p_session uuid, p_name text)
returns workout_templates language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); t workout_templates;
begin
  if not exists (select 1 from workout_sessions where id = p_session and user_id = uid) then
    raise exception 'session not found'; end if;
  insert into workout_templates(user_id, name) values (uid, coalesce(nullif(trim(p_name), ''), 'My workout'))
    returning * into t;
  insert into template_exercises(user_id, template_id, exercise_id, position)
    select uid, t.id, exercise_id, position from session_exercises where session_id = p_session;
  return t;
end $$;

-- Per-session sets for one exercise, newest first. Used for "last time" and progression.
create or replace function exercise_history(p_exercise uuid, p_limit int default 5, p_exclude_session uuid default null)
returns table(session_id uuid, local_date date, sets jsonb)
language sql stable security invoker set search_path = public as $$
  select s.id, s.local_date,
         jsonb_agg(jsonb_build_object('set', st.set_number, 'weight_kg', st.weight_kg, 'reps', st.reps,
                                      'duration_s', st.duration_s) order by st.set_number)
  from workout_sessions s join workout_sets st on st.session_id = s.id
  where s.user_id = auth.uid() and st.user_id = auth.uid() and st.exercise_id = p_exercise
    and (p_exclude_session is null or s.id <> p_exclude_session)
  group by s.id, s.local_date, s.started_at
  order by s.local_date desc, s.started_at desc
  limit least(greatest(p_limit, 1), 50);
$$;
