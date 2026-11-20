-- What migration 194 (the AI ledger) needs, as small as it can be. scripts/verify-db-ai-ledger.mjs builds a
-- throwaway database from this, then the real 194 twice, then scenarios.sql — once with the grants Supabase gave
-- every new table and function before 30.10.2026 (the runner adds them: 194's own revokes must then be what keeps
-- the browser out) and once without (what production has now: 194's own grants must then be enough).
-- Here: the three API roles, auth with a caller a scenario can switch, six accounts (1 = the owner, 2 = a second
-- allowed account, 3 = signed in but not let in by the owner lock, 4–6 = allowed accounts the gate scenarios use,
-- one each, so their rows never mix), 139's owner lock, 002's update_updated_at(), 037's audit log with 140's
-- trigger function, and pg_cron's two functions (194 schedules the daily purge).
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
-- Supabase's service role skips row level security: the claude function writes the ledger as it. Roles belong to
-- the whole server, so one made earlier by another check's base gets the same right here.
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
alter role service_role bypassrls;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- The caller: the owner unless a scenario sets test.uid ('none' = no user: a service-role or signed-out request).
create or replace function auth.uid() returns uuid language sql stable as $$
  select case when current_setting('test.uid', true) = 'none' then null
              else coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid end
$$;
insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'), ('00000000-0000-0000-0000-000000000005'), ('00000000-0000-0000-0000-000000000006');
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- 139's owner lock: every account but 3 may use the app.
create table public.app_allowed_users (user_id uuid primary key references auth.users (id) on delete cascade);
alter table public.app_allowed_users enable row level security;
insert into public.app_allowed_users
  select id from auth.users where id <> '00000000-0000-0000-0000-000000000003';
create or replace function public.is_app_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_allowed_users a where a.user_id = (select auth.uid()))
$$;
revoke all on function public.is_app_user() from public;
grant execute on function public.is_app_user() to anon, authenticated, service_role;
create or replace function public.owner_lock_apply(p_table regclass) returns void language plpgsql set search_path = '' as $$
begin
  if not (select relrowsecurity from pg_class where oid = p_table) then
    execute format('alter table %s enable row level security', p_table);
  end if;
  execute format('drop policy if exists app_owner_lock on %s', p_table);
  execute format('create policy app_owner_lock on %s as restrictive for all to public using ((select public.is_app_user())) with check ((select public.is_app_user()))', p_table);
end $$;
revoke all on function public.owner_lock_apply(regclass) from public, anon, authenticated;

-- 002
create or replace function public.update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 037's audit log and 140's trigger function (verbatim but for the retention sweep).
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
create policy "Users read own audit logs" on public.audit_logs for select using (auth.uid() = user_id);
create policy "Users delete own audit logs" on public.audit_logs for delete using (auth.uid() = user_id);
revoke all on public.audit_logs from anon, authenticated;
grant select, delete on public.audit_logs to authenticated;

create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      from jsonb_each(old_j) o
     where o.key not in ('updated_at', 'synced_at') and new_j -> o.key is distinct from o.value;
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into diff_new
      from jsonb_each(new_j) n
     where n.key not in ('updated_at', 'synced_at') and old_j -> n.key is distinct from n.value;
    if diff_new = '{}'::jsonb and diff_old = '{}'::jsonb then
      return null;
    end if;
  else
    diff_old := old_j;
    diff_new := new_j;
  end if;
  v_user := coalesce((row_j ->> 'user_id')::uuid, auth.uid());
  if v_user is not null and not exists (select 1 from auth.users where id = v_user) then
    return null;
  end if;
  insert into public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
  values (v_user, TG_TABLE_NAME, TG_OP, row_j ->> 'id', diff_old, diff_new,
          case when auth.uid() is not null then 'web' else 'service' end, txid_current());
  return null;
end;
$$;

-- pg_cron, as far as 194 uses it.
create schema if not exists cron;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(text, text, text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values ($1, $2, $3) returning jobid::bigint
$$;
create or replace function cron.unschedule(text) returns boolean language sql as $$
  delete from cron.job where jobname = $1 returning true
$$;
