-- 139 · Lock the app to its owner (security audit, 10.10.2026).
--
-- The app has one user (plus, at most, a test account). Until now every table,
-- storage bucket and most edge functions trusted "any signed-in Supabase
-- account", and whether a stranger could create one was only a dashboard
-- switch (Authentication → "Allow new users to sign up"), recorded nowhere in
-- this repository. This migration records the rule in the database itself:
--
--  1. public.app_allowed_users — the allow-list (only the ids in it may use the
--     app). No policies and no browser grants: only the SQL editor / service
--     role reads or writes it.
--  2. public.is_app_user() — true when the caller's auth.uid() is listed.
--  3. A RESTRICTIVE row-level-security policy `app_owner_lock` on every table
--     in public and on storage.objects. A restrictive policy must pass IN
--     ADDITION to the existing ones, so nothing the owner can do today changes,
--     and an unlisted account sees and writes nothing. The service role (edge
--     functions, cron) bypasses RLS and is not affected.
--  4. EXECUTE on the SECURITY DEFINER functions is taken away from anon (the
--     signed-out browser role); none of them is used before sign-in.
--
-- The owner is found from the data, not typed here: the one account that owns
-- the rows in hevy_workouts and health_metrics (the Hevy and Apple Health syncs
-- write only for the owner; tasks are the fallback). If that is not exactly one
-- account, the migration stops and changes nothing. A test account is added by
-- hand:
--     insert into public.app_allowed_users (user_id, note)
--     values ('<test account id>', 'test account');
--
-- SAFETY. The last step reads every table as the owner before and after the
-- lock (role authenticated, the owner's id as the JWT subject, exactly what the
-- browser does) and as a made-up stranger. If the owner would see a single row
-- less anywhere, or the stranger would see anything, it raises and the whole
-- migration rolls back — nothing is half-applied.
--
-- UNDO (if anything ever looks wrong):   select public.owner_lock_disable();
-- It drops every app_owner_lock policy; the allow-list stays for a re-run.
--
-- New tables: end the migration that creates them with
--     select public.owner_lock_apply('public.<table>');
-- (scripts/verify-owner-lock.cjs checks this.)

-- 1 · Allow-list ─────────────────────────────────────────────────────────────
-- Created before the transaction on purpose: if the owner cannot be found
-- below, everything else rolls back but this (empty, browser-unreadable) table
-- stays, so you can insert your id into it and run the file again.
create table if not exists public.app_allowed_users (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.app_allowed_users enable row level security;
revoke all on table public.app_allowed_users from anon, authenticated;

begin;

-- Seed the owner, only when the list is empty (a re-run never adds anyone).
-- The Hevy and Apple Health syncs write only for the owner, so exactly one
-- account may own those rows (tasks are the fallback on a project without
-- them). Anything else stops here and changes nothing.
do $$
declare
  v_ids uuid[];
begin
  if exists (select 1 from public.app_allowed_users) then
    return;
  end if;
  select array_agg(s.user_id) into v_ids
  from (
    select user_id from public.hevy_workouts
    union select user_id from public.health_metrics
  ) s
  where exists (select 1 from auth.users u where u.id = s.user_id);
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    select array_agg(distinct t.user_id) into v_ids
    from public.tasks t
    where exists (select 1 from auth.users u where u.id = t.user_id);
  end if;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    raise exception '139: could not tell which account is the owner (% accounts own synced data). Nothing was changed. Insert your user id first: insert into public.app_allowed_users (user_id, note) values (''<your id>'', ''owner''); then run this again.',
      coalesce(array_length(v_ids, 1), 0);
  end if;
  insert into public.app_allowed_users (user_id, note) values (v_ids[1], 'owner (found by 139)');
end $$;

-- 2 · The check every policy uses ────────────────────────────────────────────
create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_allowed_users a where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_app_user() from public;
grant execute on function public.is_app_user() to anon, authenticated, service_role;

-- 3 · Apply / remove the lock ───────────────────────────────────────────────
create or replace function public.owner_lock_apply(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('drop policy if exists app_owner_lock on %s', p_table);
  execute format(
    'create policy app_owner_lock on %s as restrictive for all to public '
    'using ((select public.is_app_user())) with check ((select public.is_app_user()))',
    p_table);
end;
$$;
revoke all on function public.owner_lock_apply(regclass) from public, anon, authenticated;

create or replace function public.owner_lock_disable()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select schemaname, tablename from pg_policies where policyname = 'app_owner_lock'
  loop
    execute format('drop policy app_owner_lock on %I.%I', r.schemaname, r.tablename);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.owner_lock_disable() from public, anon, authenticated;

-- 4 · Before: what the owner sees today ─────────────────────────────────────
-- Counts every public table and storage.objects as the owner and as a stranger.
-- A table the browser role may not read at all counts as -1 both times.
create or replace function pg_temp.owner_lock_counts(p_sub uuid)
returns jsonb
language plpgsql
as $$
declare
  r record;
  n bigint;
  res jsonb := '{}'::jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  for r in
    select format('%I.%I', n2.nspname, c.relname) as t
    from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and (n2.nspname = 'public' or (n2.nspname = 'storage' and c.relname = 'objects'))
    order by 1
  loop
    begin
      execute 'set local role authenticated';
      execute format('select count(*) from %s', r.t) into n;
      execute 'reset role';
    exception when insufficient_privilege then
      execute 'reset role';
      n := -1;
    end;
    res := res || jsonb_build_object(r.t, n);
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  return res;
end;
$$;

create temp table owner_lock_before on commit drop as
select (select user_id from public.app_allowed_users order by added_at limit 1) as owner_id,
       null::jsonb as counts;
update owner_lock_before set counts = pg_temp.owner_lock_counts(owner_id);

-- 5 · The lock ──────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    perform public.owner_lock_apply(r.t);
  end loop;
end $$;

drop policy if exists app_owner_lock on storage.objects;
create policy app_owner_lock on storage.objects as restrictive for all to public
  using ((select public.is_app_user())) with check ((select public.is_app_user()));

-- Signed-out callers never need the definer functions. Whoever could call one
-- before (the signed-in browser, the service role) keeps an explicit grant.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as f,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as service_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname <> 'is_app_user'
  loop
    execute format('revoke execute on function %s from public, anon', r.f);
    if r.auth_ok then execute format('grant execute on function %s to authenticated', r.f); end if;
    if r.service_ok then execute format('grant execute on function %s to service_role', r.f); end if;
  end loop;
end $$;

-- 6 · After: the owner must see exactly the same; a stranger must see nothing ─
do $$
declare
  v_owner  uuid;
  v_before jsonb;
  v_after  jsonb;
  v_other  jsonb;
  k text;
begin
  select owner_id, counts into v_owner, v_before from owner_lock_before;
  v_after := pg_temp.owner_lock_counts(v_owner);
  v_other := pg_temp.owner_lock_counts(gen_random_uuid());
  for k in select jsonb_object_keys(v_before) loop
    if (v_after ->> k) is distinct from (v_before ->> k) then
      raise exception '139 self-check: the owner would see % rows in % instead of % — nothing was changed.',
        v_after ->> k, k, v_before ->> k;
    end if;
    if (v_other ->> k)::bigint > 0 then
      raise exception '139 self-check: a stranger could still see % rows in % — nothing was changed.',
        v_other ->> k, k;
    end if;
  end loop;
  raise notice '139: owner lock on % tables; owner % sees every row as before.',
    (select count(*) from pg_policies where policyname = 'app_owner_lock'), v_owner;
end $$;

commit;
