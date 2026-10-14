-- What migration 153 (carb and fat goals on day_targets) needs, as small as it
-- can be (scripts/verify-db-day-targets-macros.mjs builds a throwaway database
-- from this, the real migrations 086, 088 and 113, the real migration 153
-- twice, and scenarios.sql): auth with two accounts, 002's update_updated_at()
-- and 037's audit log with 140's trigger function (086 and 088 attach both).
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- The caller: account 1 unless a scenario sets test.uid.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid
$$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
-- Supabase grants table rights to authenticated by default; RLS does the rest.
alter default privileges in schema public grant all on tables to authenticated;

-- 002's updated_at trigger function.
create or replace function public.update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 037's audit log and 140's trigger function.
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  table_name  text not null,
  operation   text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  row_id      text,
  old_data    jsonb,
  new_data    jsonb,
  actor       text not null,
  tx_id       bigint not null,
  created_at  timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_j    jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  new_j    jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
  row_j    jsonb := coalesce(new_j, old_j);
  diff_old jsonb;
  diff_new jsonb;
  v_user   uuid;
begin
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb) into diff_old
      from jsonb_each(old_j) o where o.key not in ('updated_at', 'synced_at') and new_j -> o.key is distinct from o.value;
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into diff_new
      from jsonb_each(new_j) n where n.key not in ('updated_at', 'synced_at') and old_j -> n.key is distinct from n.value;
    if diff_new = '{}'::jsonb and diff_old = '{}'::jsonb then return null; end if;
  else
    diff_old := old_j;
    diff_new := new_j;
  end if;
  v_user := coalesce((row_j ->> 'user_id')::uuid, auth.uid());
  if v_user is not null and not exists (select 1 from auth.users where id = v_user) then return null; end if;
  insert into public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
  values (v_user, TG_TABLE_NAME, TG_OP, row_j ->> 'id', diff_old, diff_new,
          case when auth.uid() is not null then 'web' else 'service' end, txid_current());
  return null;
end;
$$;
