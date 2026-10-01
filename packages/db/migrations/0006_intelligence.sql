-- Phase 5: daily score history (a derived cache) + configurable score weights.
create table daily_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  score int check (score between 0 and 100),          -- null = no data that day
  status text not null check (status in ('on_track','slightly_off','off_track','no_data')),
  explanation text not null,
  components jsonb not null,
  formula_version text not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table daily_scores enable row level security;
create policy ds_all on daily_scores for all using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into app_settings(key, value) values
  ('score_weights', '{"calories":30,"protein":25,"fibre":10,"activity":15,"workout":15,"goal":5}')
on conflict (key) do nothing;
