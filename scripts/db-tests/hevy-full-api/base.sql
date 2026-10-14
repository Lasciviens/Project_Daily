-- What migration 154 (Hevy's whole public API) needs, as small as it can be
-- (scripts/verify-db-hevy-full-api.mjs builds a throwaway database from this,
-- the real migrations 024 and 026 (the Hevy tables), seed.sql, the real
-- migration 154 twice, and scenarios.sql): auth with three accounts, the
-- three API roles with Supabase's default table grants (so 154's REVOKEs are
-- tested against what a real project hands out), 139's owner lock (accounts
-- 1 and 2 allowed, 3 not) and 002's update_updated_at().
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
-- Supabase's service role skips row level security; the Hevy functions write as it.
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- The caller: account 1 unless a scenario sets test.uid.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid
$$;
insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase gives every new public table to all three roles; a migration takes back what it must.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- 139's owner lock.
create table public.app_allowed_users (user_id uuid primary key references auth.users (id) on delete cascade);
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
create or replace function public.is_app_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_allowed_users a where a.user_id = (select auth.uid()))
$$;
grant execute on function public.is_app_user() to authenticated, anon, service_role;
create or replace function public.owner_lock_apply(p_table regclass) returns void language plpgsql set search_path = '' as $$
begin
  if not (select relrowsecurity from pg_class where oid = p_table) then
    execute format('alter table %s enable row level security', p_table);
  end if;
  execute format('drop policy if exists app_owner_lock on %s', p_table);
  execute format('create policy app_owner_lock on %s as restrictive for all to public using ((select public.is_app_user())) with check ((select public.is_app_user()))', p_table);
end $$;

-- 002's updated_at trigger function.
create or replace function public.update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
