-- The Google Tasks schema as far as migration 145 needs it
-- (scripts/verify-db-google-tasks-pull.mjs builds a throwaway database from
-- this, the real migration twice and scenarios.sql). auth.uid() / auth.role()
-- read two settings the scenarios set, standing in for Supabase's JWT.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;

insert into auth.users values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

-- 072
create function public.effective_user_id(p_user_id uuid) returns uuid language sql stable as $$
  select case when auth.role() = 'service_role' then p_user_id else auth.uid() end
$$;

-- 071 + 076 (the index 145 drops)
create table public.google_task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_id text not null,
  title text not null,
  is_default boolean not null default false,
  google_etag text,
  google_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_id)
);
create unique index google_task_lists_user_lower_title on public.google_task_lists (user_id, lower(title));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  domain text not null default 'personal',
  section text not null default 'inbox',
  priority text not null default 'medium',
  status text not null default 'open' check (status in ('open','in_progress','waiting','done','cancelled')),
  due_date date,
  source_type text not null default 'manual',
  sort_order integer default 0,
  google_task_id text,
  google_tasklist_id uuid references public.google_task_lists(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete set null,
  completed_at timestamptz,
  google_position text,
  google_etag text,
  google_updated_at timestamptz,
  google_web_view_link text,
  google_links jsonb,
  google_hidden boolean not null default false,
  google_deleted boolean not null default false,
  google_local_edit_at timestamptz,
  google_sync_enabled boolean not null default false
);
create unique index tasks_user_google_task_id on public.tasks (user_id, google_task_id) where google_task_id is not null;

create table public.google_tasks_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 072
create table public.google_tasks_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 129's closed-at stamp (the pull sends Google's own completion time).
create function public.stamp_task_closed_at() returns trigger language plpgsql as $$
begin
  if new.status in ('done', 'cancelled') then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from new.status then
      if new.completed_at is not distinct from old.completed_at or new.completed_at is null then
        new.completed_at := now();
      end if;
    elsif new.completed_at is null then
      new.completed_at := coalesce(old.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger trg_tasks_closed_at before insert or update on public.tasks
  for each row execute function public.stamp_task_closed_at();

-- A stand-in for 071/140's outbox trigger: any write the pull did NOT mark as
-- Google's own would queue an 'update' here.
create function public.enqueue_google_tasks_outbox() returns trigger language plpgsql as $$
begin
  if current_setting('app.google_sync_write', true) = 'true' then return null; end if;
  insert into public.google_tasks_outbox (user_id, task_id, operation) values (new.user_id, new.id, 'update');
  return null;
end $$;
create trigger trg_enqueue_google_tasks_outbox after insert or update on public.tasks
  for each row execute function public.enqueue_google_tasks_outbox();

-- 075's upsert (the signature 145 replaces) and set_task_parent_from_google.
create function public.upsert_task_from_google(
  p_google_task_id text, p_title text, p_notes text, p_due_date date, p_status text,
  p_google_updated_at timestamptz, p_google_tasklist_id uuid default null, p_parent_task_id uuid default null,
  p_completed_at timestamptz default null, p_google_etag text default null, p_google_position text default null,
  p_google_web_view_link text default null, p_google_hidden boolean default false, p_google_deleted boolean default false,
  p_user_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return null;
end $$;
grant execute on function public.upsert_task_from_google(text, text, text, date, text, timestamptz, uuid, uuid, timestamptz, text, text, text, boolean, boolean, uuid) to anon, authenticated, service_role;

create function public.set_task_parent_from_google(p_task_id uuid, p_parent_task_id uuid, p_user_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.google_sync_write', 'true', true);
  update public.tasks set parent_task_id = p_parent_task_id
   where id = p_task_id and user_id = public.effective_user_id(p_user_id);
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

-- Two lists of one name on Google could not both be mirrored before 145.
insert into public.google_task_lists (id, user_id, google_id, title, is_default) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000a1', 'gl-default', 'My Tasks', true);
