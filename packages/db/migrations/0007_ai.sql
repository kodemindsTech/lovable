-- Phase 6: AI coach persistence, consent check, and server-side quota.
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);
create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  structured jsonb,                      -- validated CoachReply for assistant turns
  source text check (source in ('ai','rules','safety')),
  prompt_version text,
  safety_flag boolean not null default false,
  created_at timestamptz not null default now()
);
create index on ai_messages(conversation_id, created_at);
create index on ai_messages(user_id, created_at desc);

create table ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
create index on ai_usage(user_id, kind, created_at);

alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
alter table ai_usage enable row level security;
create policy conv_all on ai_conversations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy msg_select on ai_messages for select using (user_id = auth.uid());
create policy msg_insert on ai_messages for insert with check (user_id = auth.uid()
  and exists (select 1 from ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy msg_delete on ai_messages for delete using (user_id = auth.uid());
-- Usage is read-only for users; rows are written only by ai_consume() below, so quota can't be reset by deleting rows.
create policy usage_select on ai_usage for select using (user_id = auth.uid());

-- Latest ai_processing consent decision for the caller.
create or replace function has_ai_consent() returns boolean
language sql stable security invoker set search_path = public as $$
  select coalesce((select granted from consents where user_id = auth.uid() and purpose = 'ai_processing'
                   order by created_at desc, id desc limit 1), false);
$$;

-- Atomically checks and consumes one unit of the caller's daily AI quota. Fails closed if unconfigured.
-- Limits live in app_settings('ai_quota') as {"coach_daily": n}; plan-based limits arrive with subscriptions.
create or replace function ai_consume(p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lim int; used int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select (value ->> (p_kind || '_daily'))::int into lim from app_settings where key = 'ai_quota';
  if lim is null then raise exception 'ai_quota_not_configured'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_kind, 0));
  select count(*) into used from ai_usage
    where user_id = uid and kind = p_kind and created_at >= date_trunc('day', now() at time zone 'utc');
  if used >= lim then raise exception 'quota_exceeded'; end if;
  insert into ai_usage(user_id, kind) values (uid, p_kind);
  return lim - used - 1;
end $$;
revoke all on function ai_consume(text) from public;
grant execute on function ai_consume(text) to authenticated;

insert into app_settings(key, value) values ('ai_quota', '{"coach_daily": 20}') on conflict (key) do nothing;
