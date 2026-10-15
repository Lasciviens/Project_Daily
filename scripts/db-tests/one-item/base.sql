-- What migration 155 (one item) needs, as the live database has it
-- (scripts/verify-db-one-item.mjs builds a throwaway database from this, the
-- REAL migrations 135 (calendar outbox), 144 (delete with undo), 147 (plan
-- series), 150 and 151 (Undo this save), seed.sql, then 155 twice, then
-- scenarios.sql): auth with a switchable caller, the owner lock (139), the
-- audit log as 037/140 write it, tasks / time_blocks / schedule_blocks with
-- the columns, checks, indexes and triggers the item save meets (071/140's
-- Google Tasks outbox, 077's title mirror and one-slot-per-task index, 080's
-- length bounds, 129's close time, 142's occurrence rule, 146's repeat kinds,
-- 147/148's series columns), row level security and a second account.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- test.uid picks the caller: unset = the owner, 'none' = a service-role write (no user).
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

-- 139's owner lock (user 3 is NOT allowed)
create table public.app_allowed_users (user_id uuid primary key);
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
create or replace function public.is_app_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_allowed_users a where a.user_id = (select auth.uid()))
$$;
grant execute on function public.is_app_user() to authenticated, service_role;
create or replace function public.owner_lock_apply(p_table regclass) returns void language plpgsql set search_path = '' as $$
begin
  execute format('drop policy if exists app_owner_lock on %s', p_table);
  execute format('create policy app_owner_lock on %s as restrictive for all to public using ((select public.is_app_user())) with check ((select public.is_app_user()))', p_table);
end $$;

-- 037's audit log and 140's trigger function (verbatim but for the retention sweep)
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
grant select, delete on public.audit_logs to authenticated;
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

create or replace function public.update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Google Tasks' list mirror (071)
create table public.google_task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  google_tasklist_id text not null,
  title text not null
);

-- tasks as 001/004/016/018/019/039/047/069/071/141 left it
create table public.tasks (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title                    text not null,
  description              text,
  domain                   text not null default 'personal' check (domain in ('personal', 'work', 'media')),
  section                  text not null default 'inbox' check (section in ('inbox', 'today', 'tomorrow', 'this_week', 'backlog')),
  status                   text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority                 text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  start_date               date,
  due_date                 date,
  due_time                 time,
  waiting_for              text,
  is_focused               boolean default false,
  source_type              text not null default 'manual'
                           check (source_type in ('manual', 'movie', 'tv_series', 'media', 'calendar', 'ai', 'training_session', 'project_item')),
  source_id                uuid,
  sort_order               integer not null default 0,
  google_task_id           text,
  google_calendar_event_id text,
  google_tasklist_id       uuid references public.google_task_lists(id) on delete set null,
  parent_task_id           uuid references public.tasks(id) on delete set null,
  completed_at             timestamptz,
  google_position          text,
  google_etag              text,
  google_updated_at        timestamptz,
  google_web_view_link     text,
  google_links             jsonb,
  google_hidden            boolean not null default false,
  google_deleted           boolean not null default false,
  google_local_edit_at     timestamptz,
  google_sync_enabled      boolean not null default false,
  hevy_routine_id          text,
  hevy_workout_id          text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
create unique index tasks_user_google_task_id on public.tasks (user_id, google_task_id) where google_task_id is not null;
create trigger trg_tasks_updated_at before update on public.tasks for each row execute function public.update_updated_at();
-- 129: the close time, for every writer
create or replace function public.tasks_closed_at() returns trigger language plpgsql as $$
begin
  if new.status in ('done', 'cancelled') and (TG_OP = 'INSERT' or old.status not in ('done', 'cancelled')) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status not in ('done', 'cancelled') then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger trg_tasks_closed_at before insert or update of status on public.tasks for each row execute function public.tasks_closed_at();
-- 071: a local edit of a Google-visible field stamps the local-edit clock
create or replace function public.stamp_google_local_edit() returns trigger language plpgsql as $$
begin
  if current_setting('app.google_sync_write', true) = 'true' then return new; end if;
  if TG_OP = 'INSERT' or (new.title, new.description, new.due_date, new.status, new.parent_task_id, new.google_tasklist_id)
       is distinct from (old.title, old.description, old.due_date, old.status, old.parent_task_id, old.google_tasklist_id) then
    new.google_local_edit_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger trg_stamp_google_local_edit before insert or update on public.tasks for each row execute function public.stamp_google_local_edit();

-- 071/140's Google Tasks outbox (the branches 155 meets)
create table public.google_tasks_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function public.enqueue_google_tasks_outbox() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.google_sync_write', true) = 'true' then return null; end if;
  if TG_OP = 'DELETE' then
    if old.google_task_id is not null and old.google_sync_enabled and exists (select 1 from auth.users where id = old.user_id) then
      insert into public.google_tasks_outbox (user_id, task_id, operation) values (old.user_id, old.id, 'delete');
    end if;
    return old;
  end if;
  if TG_OP = 'INSERT' then
    if new.google_sync_enabled then
      insert into public.google_tasks_outbox (user_id, task_id, operation) values (new.user_id, new.id, 'create');
    end if;
    return new;
  end if;
  if new.google_sync_enabled and not old.google_sync_enabled then
    insert into public.google_tasks_outbox (user_id, task_id, operation, payload)
    values (new.user_id, new.id, 'create', jsonb_build_object('force_recreate', new.google_task_id is not null));
    return new;
  end if;
  if not new.google_sync_enabled and old.google_sync_enabled and old.google_task_id is not null then
    insert into public.google_tasks_outbox (user_id, task_id, operation) values (new.user_id, new.id, 'delete');
    return new;
  end if;
  if new.google_local_edit_at is distinct from old.google_local_edit_at and new.google_sync_enabled and new.google_task_id is not null then
    insert into public.google_tasks_outbox (user_id, task_id, operation) values (new.user_id, new.id, 'update');
  end if;
  return new;
end $$;
create trigger trg_enqueue_google_tasks_outbox after insert or update or delete on public.tasks
  for each row execute function public.enqueue_google_tasks_outbox();

-- schedule_blocks as 004/077/081/142/146/147/148 left it
create table public.schedule_blocks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null,
  days_of_week    int[] not null,
  start_time      time not null,
  end_time        time not null,
  color           text not null default 'blue',
  category        text not null default 'other',
  effective_from  date not null default current_date,
  except_dates    date[] not null default '{}',
  repeat_kind     text not null default 'weekly',
  repeat_interval integer,
  repeat_unit     text,
  repeat_dates    date[],
  google_calendar_event_id  text,
  google_calendar_horizon   date,
  google_calendar_time_zone text,
  google_calendar_from      date,
  created_at      timestamptz default now(),
  updated_at      timestamptz not null default now()
);
alter table public.schedule_blocks add constraint schedule_blocks_repeat_check check (coalesce(
  case repeat_kind
    when 'weekly' then repeat_interval is null and repeat_unit is null and repeat_dates is null
    when 'monthly' then repeat_interval is null and repeat_unit is null and repeat_dates is null
      and cardinality(days_of_week) <= 1 and days_of_week <@ array[0,1,2,3,4,5,6]
    when 'interval' then repeat_interval between 1 and 99 and repeat_dates is null and days_of_week <@ array[0,1,2,3,4,5,6]
      and case repeat_unit when 'day' then cardinality(days_of_week) = 0 when 'week' then cardinality(days_of_week) >= 1
                           when 'month' then cardinality(days_of_week) <= 1 else false end
    when 'dates' then repeat_interval is null and repeat_unit is null and cardinality(repeat_dates) between 1 and 366
      and array_position(repeat_dates, null) is null and cardinality(days_of_week) = 0
    else false
  end, false));

-- time_blocks as 004/010/038/043/077/080/142 left it
create table public.time_blocks (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date                     date not null,
  title                    text not null,
  start_time               time,
  duration_minutes         integer not null default 60 constraint time_blocks_duration_minutes_range check (duration_minutes between 1 and 1440),
  color                    text not null default 'accent',
  category                 text not null default 'daily',
  task_id                  uuid references public.tasks(id) on delete cascade,
  source_type              text check (source_type in ('training_session', 'movie', 'tv_episode', 'project_item', 'calendar', 'manual')),
  source_id                uuid,
  season_number            integer,
  episode_number           integer,
  notes                    text,
  google_calendar_event_id text,
  schedule_block_id        uuid references public.schedule_blocks(id) on delete set null,
  occurrence_date          date,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
create unique index time_blocks_one_per_task on public.time_blocks (task_id) where task_id is not null;
create unique index time_blocks_occurrence_key on public.time_blocks (schedule_block_id, occurrence_date)
  where schedule_block_id is not null and occurrence_date is not null;
create trigger trg_time_blocks_updated_at before update on public.time_blocks for each row execute function public.update_updated_at();
-- 142: a day of a plan made its own takes that day out of the plan
create or replace function public.occurrence_replaces_day() returns trigger language plpgsql set search_path = public as $$
begin
  if new.schedule_block_id is null or new.occurrence_date is null then return null; end if;
  update schedule_blocks set except_dates = array_append(except_dates, new.occurrence_date)
   where id = new.schedule_block_id and not (new.occurrence_date = any (except_dates));
  return null;
end $$;
create trigger trg_occurrence_replaces_day after insert or update of schedule_block_id, occurrence_date on public.time_blocks
  for each row execute function public.occurrence_replaces_day();
-- 077: the task's title is mirrored onto its slot
create or replace function public.sync_time_block_title_from_task() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 and new.title is distinct from old.title then
    update public.time_blocks set title = new.title, updated_at = now() where task_id = new.id and title is distinct from new.title;
  end if;
  return new;
end $$;
create trigger trg_sync_time_block_title_from_task after update on public.tasks for each row execute function public.sync_time_block_title_from_task();

-- Row level security as the app has it: own rows only, the owner lock, audited like 037
do $$
declare t text;
begin
  foreach t in array array['tasks', 'time_blocks', 'schedule_blocks', 'google_task_lists'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('select public.owner_lock_apply(%L)', 'public.' || t);
  end loop;
  foreach t in array array['tasks', 'time_blocks'] loop
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.log_audit()', t);
  end loop;
end $$;
alter table public.google_tasks_outbox enable row level security;
create policy own_read on public.google_tasks_outbox for select to authenticated using (user_id = (select auth.uid()));
grant select on public.google_tasks_outbox to authenticated;
-- the service role reads and writes everything (it bypasses row level security in Supabase)
grant all on all tables in schema public to service_role;
alter role service_role bypassrls;

-- The rules 155 extends (their REAL functions and triggers are loaded from the
-- migrations by verify-db-one-item.mjs, right after this file): 043's link
-- rules and its project-item cleanup, 117's Trakt-sync switch, 142's
-- training day/time pair, 149's planned-episode cleanup. Their tables, as
-- small as they can be.
create table public.link_rules (rule_name text primary key, enabled boolean not null default true);
insert into public.link_rules values ('episode_watched_cleans_block', true), ('project_item_delete_cleans_block', true);
create or replace function public.link_rule_enabled(p_rule_name text)
returns boolean language sql stable set search_path = public as $$
  select coalesce((select enabled from public.link_rules where rule_name = p_rule_name), false);
$$;
grant execute on function public.link_rule_enabled(text) to authenticated;
create or replace function public.trakt_sync_writing() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-trakt-sync', '') = '1'
      or coalesce(current_setting('app.trakt_sync', true), '') = 'on'
$$;
create table public.user_tv_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null
);
create table public.user_tv_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tv_entry_id uuid not null references public.user_tv_entries(id) on delete cascade,
  season_number integer not null, episode_number integer not null,
  watched_at timestamptz
);
create table public.media_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('movie', 'episode')),
  episode_id uuid references public.user_tv_episodes(id) on delete cascade,
  tv_series_id uuid,
  season_number integer, episode_number integer,
  watched_at timestamptz,
  source text not null default 'app'
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null
);
create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled'))
);
do $$
declare t text;
begin
  foreach t in array array['user_tv_entries', 'user_tv_episodes', 'media_watches', 'projects', 'project_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.log_audit()', t);
  end loop;
end $$;
