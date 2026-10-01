-- Phase 10: hardening.
-- 1) Function privileges: nothing is executable by PUBLIC/anon unless explicitly allowed.
--    (Postgres grants EXECUTE to PUBLIC by default, and Supabase exposes public-schema functions over the API.)
-- 2) effective_plan() no longer lets a signed-in user look up someone else's plan.

create or replace function effective_plan(p_user uuid, p_now timestamptz default now()) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  -- auth.uid() is null for the server (service role); signed-in callers may only ask about themselves (admins excepted).
  if auth.uid() is not null and p_user is distinct from auth.uid() and not has_admin_role('support', 'finance') then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select case s.status
      when 'trialing' then case when s.trial_end > p_now then s.plan_id end
      when 'active'   then case when s.current_period_end + make_interval(hours => coalesce((select (value->>'period_skew_hours')::int from app_settings where key='billing'), 12)) > p_now then s.plan_id end
      when 'past_due' then case when s.grace_until > p_now then s.plan_id end
    end
    from subscriptions s where s.user_id = p_user), 'free');
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- Server-only functions: not callable by signed-in users.
revoke execute on function apply_subscription_event(jsonb) from authenticated;
-- Only these are needed before sign-in: RLS policies on public tables evaluate has_admin_role() for anon requests.
grant execute on function has_admin_role(text[]) to anon;
-- Future functions are private by default; grant explicitly in the migration that creates them.
-- (No "in schema": a schema-scoped REVOKE cannot remove Postgres' built-in EXECUTE-to-PUBLIC default.)
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
