-- What migration 160 (supplement schedules and reminders) needs, as small as
-- it can be (scripts/verify-db-supplement-schedules.mjs builds a throwaway
-- database from this, 156's repeat rule functions as 156 wrote them, the real
-- migration 144 — the delete with Undo the card uses —, the real 160 twice and
-- scenarios.sql): auth with a switchable caller ('none' = the service role,
-- like phone-gateway and push-send), 139's owner lock (accounts 1 and 2
-- allowed, 3 not), 037's audit log with 140's trigger function, 072's
-- effective_user_id, the food tables the diary line touches (053 / 061 / 087
-- columns, a stand-in for 106's totals trigger), schedule_blocks with 146's
-- repeat columns (156's repeat_occurs_on takes its row), and stand-ins for
-- pg_cron, pg_net and Vault with the real call shapes (the throwaway Postgres
-- has none of them).
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- test.uid picks the caller: unset = account 1, 'none' = a service-role call (no user).
create or replace function auth.uid() returns uuid language sql stable as $$
  select case when current_setting('test.uid', true) = 'none' then null
              else coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid end
$$;
create or replace function auth.role() returns text language sql stable as $$
  select case when current_setting('test.uid', true) = 'none' then 'service_role' else 'authenticated' end
$$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
                              ('00000000-0000-0000-0000-000000000003');
grant usage on schema public to authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function auth.role() to authenticated, service_role;

-- 139's owner lock (account 3 is NOT allowed)
create table public.app_allowed_users (user_id uuid primary key references auth.users (id) on delete cascade);
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
create or replace function public.is_app_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_allowed_users a where a.user_id = (select auth.uid()))
$$;
grant execute on function public.is_app_user() to authenticated, service_role;
create or replace function public.owner_lock_apply(p_table regclass) returns void language plpgsql set search_path = '' as $$
begin
  if not (select relrowsecurity from pg_class where oid = p_table) then
    execute format('alter table %s enable row level security', p_table);
  end if;
  execute format('drop policy if exists app_owner_lock on %s', p_table);
  execute format('create policy app_owner_lock on %s as restrictive for all to public using ((select public.is_app_user())) with check ((select public.is_app_user()))', p_table);
end $$;

-- 072's scope for an RPC that the service role calls for an account
create or replace function public.effective_user_id(p_user_id uuid) returns uuid language sql stable as $$
  select case when auth.role() = 'service_role' then p_user_id else auth.uid() end
$$;
grant execute on function public.effective_user_id(uuid) to authenticated, service_role;

-- 037's audit log and 140's trigger function
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
grant select on public.audit_logs to authenticated;
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

-- The food tables (053 / 057 / 061 / 087 / 157) with the columns the diary line touches
create table public.recipe_ingredient_library (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  unit          text not null default 'g',
  calories      numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugar_g numeric,
  serving_label text, serving_grams numeric,
  food_group    text
);
create table public.recipes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title     text not null,
  servings  integer not null default 1,
  category  text,
  serving_label text,   -- 157: one portion's word ("piece"); null = "portion"
  calories  numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugar_g numeric
);
create table public.food_log_entries (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date                  date not null,
  meal_slot             text not null check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack', 'supplement')),
  library_ingredient_id uuid references public.recipe_ingredient_library(id) on delete set null,
  recipe_id             uuid references public.recipes(id) on delete set null,
  custom_title          text,
  quantity              numeric,
  unit                  text,
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugar_g numeric,
  status                text not null default 'eaten' check (status in ('planned', 'eaten')),
  meal_group_id         uuid,
  created_at            timestamptz not null default now(),
  check (library_ingredient_id is not null or recipe_id is not null or custom_title is not null)
);
-- 106's totals, short: an eaten food line = per 100 g × grams, a recipe line = per portion × portions
create or replace function public.trg_food_log_entries_compute() returns trigger language plpgsql as $$
declare l record; r record;
begin
  if coalesce(new.status, 'eaten') <> 'eaten' or new.quantity is null then return new; end if;
  if new.recipe_id is not null then
    select calories, protein_g into r from public.recipes where id = new.recipe_id;
    if found and r.calories is not null then
      new.calories := round(r.calories * new.quantity, 1); new.protein_g := round(r.protein_g * new.quantity, 1);
    end if;
  elsif new.library_ingredient_id is not null and coalesce(new.unit, 'g') in ('g', 'ml') then
    select calories, protein_g into l from public.recipe_ingredient_library where id = new.library_ingredient_id;
    if found then
      new.calories := round(l.calories * new.quantity / 100, 2); new.protein_g := round(l.protein_g * new.quantity / 100, 2);
    end if;
  end if;
  return new;
end $$;
create trigger trg_food_log_entries_compute before insert or update on public.food_log_entries
  for each row execute function public.trg_food_log_entries_compute();
create trigger trg_audit after insert or update or delete on public.food_log_entries
  for each row execute function public.log_audit();
do $$
declare t text;
begin
  foreach t in array array['recipe_ingredient_library', 'recipes', 'food_log_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    perform public.owner_lock_apply(format('public.%I', t)::regclass);
  end loop;
end $$;

-- schedule_blocks with 146's repeat columns (156's repeat_occurs_on takes its row)
create table public.schedule_blocks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null,
  days_of_week    integer[] not null default '{}',
  effective_from  date,
  except_dates    date[] not null default '{}',
  repeat_kind     text not null default 'weekly',
  repeat_interval integer,
  repeat_unit     text,
  repeat_dates    date[]
);

-- pg_cron's job list and its two calls, as the extension has them
create schema if not exists cron;
create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null
);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
-- pg_net's http_post (its parameter names) records the call instead of sending it
create schema if not exists net;
create table net.t_calls (id bigserial primary key, url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                         headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.t_calls (url, headers, body) values (url, headers, body) returning id
$$;
-- Vault's decrypted view
create schema if not exists vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('PUSH_CRON_SECRET', 'test-cron-secret');
