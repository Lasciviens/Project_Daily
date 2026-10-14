-- The shapes "Undo this save" (migrations 150 and 151) has to handle, as
-- small as they can be (scripts/verify-db-undo-save.mjs builds a throwaway
-- database from this, the real migrations 144, 150 and 151 — twice — and
-- scenarios.sql): the audit log as 037/140 write it, audited tables with
-- cascades and SET NULL links, the Google Tasks and Calendar outboxes with
-- their triggers (071/140, 135), 071's local-edit stamp, 043's rule that a
-- watched episode deletes its plan, tables outside the log, a generated
-- column, a unique slot, a composite key, a table without a key, a
-- one-row-per-account table keyed by user_id, a rule that rewrites a row put
-- back, row level security and a second account.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- test.uid picks the caller: unset = the owner, 'none' = a service-role write (no user).
create or replace function auth.uid() returns uuid language sql stable as $$
  select case when current_setting('test.uid', true) = 'none' then null
              else coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid end
$$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;

-- 139's owner lock helper (only the owner uses the app)
create table public.app_allowed_users (user_id uuid primary key);
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
create or replace function public.is_app_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_allowed_users a where a.user_id = (select auth.uid()))
$$;
grant execute on function public.is_app_user() to authenticated;

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

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- TV: a show and its episodes (the 73-episode save)
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
  watched_at timestamptz, rating integer,
  updated_at timestamptz not null default now()
);
create trigger trg_updated_at before update on public.user_tv_episodes for each row execute function public.set_updated_at();

-- Tasks with their slot, a subtask link and a Google Tasks outbox like 140's
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'open',
  parent_task_id uuid references public.tasks(id) on delete set null,
  google_task_id text, google_sync_enabled boolean not null default false,
  google_hidden boolean not null default false, google_deleted boolean not null default false,
  due_date date,
  google_local_edit_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger trg_updated_at before update on public.tasks for each row execute function public.set_updated_at();
-- 071: every local write stamps the task's local-edit clock (a row put back too)
create or replace function public.stamp_google_local_edit() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' or new.title is distinct from old.title or new.status is distinct from old.status then
    new.google_local_edit_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger trg_stamp_google_local_edit before insert or update on public.tasks for each row execute function public.stamp_google_local_edit();
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  date date not null, start_time time, title text,
  google_calendar_event_id text,
  -- 043: a plan for a TV episode (source = the show's library entry)
  source_type text, source_id uuid, season_number integer, episode_number integer
);
-- outside the log (no trg_audit): what a task's delete takes here can't come back
create table public.task_tags (
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag text not null,
  primary key (task_id, tag)
);
-- outside the log too, linked by SET NULL: a deleted task's comments stay, unlinked
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  body text
);
create table public.google_tasks_outbox (
  id bigserial primary key,
  user_id uuid not null,
  task_id uuid not null,
  operation text not null,
  created_at timestamptz not null default now()
);
create or replace function public.enqueue_google_tasks_outbox() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    if old.google_task_id is not null and old.google_sync_enabled then
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
  -- 140: a local edit of a synced task goes to Google as an update
  if new.google_local_edit_at is distinct from old.google_local_edit_at and new.google_sync_enabled and new.google_task_id is not null then
    insert into public.google_tasks_outbox (user_id, task_id, operation) values (new.user_id, new.id, 'update');
  end if;
  return new;
end $$;
create trigger trg_google_tasks_outbox after insert or update or delete on public.tasks
  for each row execute function public.enqueue_google_tasks_outbox();

-- 135: a deleted slot's Google Calendar event is queued for removal
create table public.calendar_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null default 'primary',
  event_id text not null,
  operation text not null default 'delete',
  time_block_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, calendar_id, event_id)
);
create or replace function public.enqueue_calendar_event_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.google_calendar_event_id is null then return null; end if;
  insert into public.calendar_outbox (user_id, event_id, time_block_id) values (old.user_id, old.google_calendar_event_id, old.id)
  on conflict (user_id, calendar_id, event_id) do nothing;
  return null;
end $$;
create trigger trg_enqueue_calendar_event_delete after delete on public.time_blocks
  for each row execute function public.enqueue_calendar_event_delete();

-- Projects: a delete cascades to the items
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  code text unique
);
-- outside the log, keyed on a column that may be empty: only a project with a
-- code could have had links there
create table public.project_links (
  id uuid primary key default gen_random_uuid(),
  project_code text not null references public.projects(code) on delete cascade,
  url text
);
create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text
);

-- A generated column, and a column the scenarios drop
create table public.food_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  calories numeric,
  kcal_x2 numeric generated always as (calories * 2) stored
);
create table public.wish_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  note text
);

-- A unique slot: a save that frees a slot and fills it again
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slot integer not null,
  label text,
  unique (user_id, slot)
);

-- A composite key (the log has no row id) and a table without a key
create table public.pairs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  a text not null, b text not null,
  primary key (user_id, a)
);
create table public.legacy_notes (
  id uuid default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text
);

-- A one-row-per-account table: its key is user_id (games_prefs, reading_settings…)
create table public.prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  theme text,
  page_size integer
);

-- A rule that rewrites a row put back: stamped when inserted
create table public.stamped_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text,
  stamped_at timestamptz
);
create or replace function public.stamp_note() returns trigger language plpgsql as $$
begin new.stamped_at := clock_timestamp(); return new; end $$;
create trigger trg_stamp_note before insert on public.stamped_notes for each row execute function public.stamp_note();

-- 043: watching an episode deletes its planned slot (by source, not a foreign key)
create or replace function public.cleanup_block_on_episode_watched() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.time_blocks
   where source_type = 'tv_episode' and source_id = new.tv_entry_id
     and season_number = new.season_number and episode_number = new.episode_number;
  return new;
end $$;
create trigger trg_cleanup_block_on_episode_watched after insert on public.user_tv_episodes
  for each row execute function public.cleanup_block_on_episode_watched();

-- A rule that fights back: a locked row keeps its value whatever is written
create table public.guarded (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  value integer,
  locked boolean not null default false
);
create or replace function public.guarded_keep() returns trigger language plpgsql as $$
begin
  if old.locked and new.value is distinct from old.value then new.value := old.value; end if;
  return new;
end $$;
create trigger trg_guarded before update on public.guarded for each row execute function public.guarded_keep();

-- Row level security as the app has it: own rows only. Audited like 037.
do $$
declare t text;
begin
  foreach t in array array['user_tv_entries', 'user_tv_episodes', 'tasks', 'time_blocks', 'projects', 'project_items',
                           'food_log_entries', 'wish_items', 'slots', 'pairs', 'legacy_notes', 'guarded', 'prefs', 'stamped_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.log_audit()', t);
  end loop;
end $$;
grant select, insert, update, delete on public.task_tags to authenticated;
grant select, insert, update, delete on public.task_comments to authenticated;
grant select, insert, update, delete on public.project_links to authenticated;
alter table public.calendar_outbox enable row level security;
create policy own_read on public.calendar_outbox for select to authenticated using (user_id = auth.uid());
grant select on public.calendar_outbox to authenticated;
-- a table the caller may read but not update (no UPDATE policy)
create table public.locked_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text
);
alter table public.locked_notes enable row level security;
create policy own_read on public.locked_notes for select to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.locked_notes to authenticated;
create trigger trg_audit after insert or update or delete on public.locked_notes for each row execute function public.log_audit();
alter table public.google_tasks_outbox enable row level security;
create policy own on public.google_tasks_outbox for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.google_tasks_outbox to authenticated;
