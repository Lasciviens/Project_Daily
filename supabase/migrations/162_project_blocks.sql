-- ═══════════════════════════════════════════════════════════════════════════
-- 162 — Projects for every kind of project (owner go 18.10.2026: "Be done
-- with this page. You can build it.", after the mockup).
--
-- Before this a project held a name, a description, notes, phases and
-- "items" typed in software words (update / bug / UI request …) that lived
-- in their own table and reached Daily or Work only once scheduled. The
-- kitchen scale (docs/kitchen-scale/README.md) didn't fit: it has a status
-- line, a dated log, parts tables, decisions and open questions, guides and
-- links. Now a project is a header, a plan and a few general blocks:
--
--  A. projects: kind (the template it started from — hardware, software,
--     home, learning, trip, blank), area (personal | work: its tasks' domain
--     follows it), a status line with the time it was last changed (set by
--     the tidy trigger, like 129's close time: a writer that sends its own
--     time — Undo — keeps it), start and target days, and one main link.
--     Existing projects become area personal, so their tasks stay off the
--     Work board until the owner moves a project to Work.
--  B. project_phases: done_when (the phase's finish line), target_on, and
--     done_at (stamped when the phase is marked done, cleared on reopen).
--  C. A project's tasks ARE tasks (the one task table): tasks.project_id
--     (ON DELETE CASCADE — deleting a project deletes its tasks; 144's
--     app_delete_rows follows the key, so Undo brings them back) and
--     tasks.project_phase_id (ON DELETE SET NULL — deleting a phase keeps
--     its tasks in the project). A trigger keeps the pair honest: a phase
--     sets its own project, a project must be the task owner's, and a new
--     task in a project takes the project's area as its domain (a media
--     task stays media), whoever writes it.
--  D. project_blocks — the blocks a project is built from: table (columns in
--     settings), log, decisions (questions and decisions), pages (text
--     pages) and links.
--  E. project_entries — what a block holds: a table row (data, one key per
--     column), a log entry (entry_date, title, body), a question or decision
--     (state open | decided, entry_date = the day it was decided), a text
--     page (title, body) or a link (title, url, body as a note). project_id
--     is filled from the block.
--  F. The old items move into tasks: an item that was planned already has a
--     task (source project_item) — the newest open one, else the newest,
--     becomes the project task. Every other item becomes a new undated task
--     in Backlog with its status, priority, notes and order, Google sync off,
--     and source project_item + the item's id, so a re-run finds it. Undated
--     and in Backlog, an open one is on no day and in none of the Today lists;
--     it shows in the Tasks tab's "No date" group like every undated task. A
--     closed item's close time is its last change (updated_at) — the closest
--     the old table kept (129's trigger keeps a sent one), never "closed
--     today" — so it shows among that day's closed tasks. The item's type
--     (update / bug / …) is not carried over. project_items stays as the
--     record of the old items; the app no longer reads it, and 043's rule
--     that a deleted item takes its slots and closes their tasks is switched
--     off (link_rules): an item now goes only with its phase or project, and
--     a deleted phase must keep the tasks 162 made of its items.
--  G. app_create_project(project, phases, blocks) — a new project with its
--     template's phases and blocks in one transaction.
--
-- Audit: project_blocks and project_entries get trg_audit (user-authored);
-- projects, project_phases and tasks have had it since 037.
-- Re-runnable: IF NOT EXISTS, guarded constraints and policies, DROP … IF
-- EXISTS before every trigger, and F skips what it already moved.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. projects ─────────────────────────────────────────────────────────────
alter table public.projects add column if not exists kind text not null default 'blank';
alter table public.projects add column if not exists area text not null default 'personal';
alter table public.projects add column if not exists status_line text;
alter table public.projects add column if not exists status_line_at timestamptz;
alter table public.projects add column if not exists started_on date;
alter table public.projects add column if not exists target_on date;
alter table public.projects add column if not exists link_url text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_kind_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_kind_check
      check (kind in ('hardware', 'software', 'home', 'learning', 'trip', 'blank'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_area_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_area_check check (area in ('personal', 'work'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_status_line_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_status_line_check
      check (status_line is null or char_length(status_line) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_link_url_check' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_link_url_check
      check (link_url is null or (char_length(link_url) <= 2000 and link_url ~* '^https?://'));
  end if;
end $$;

-- A project started the day it was made, unless the owner says otherwise.
update public.projects
   set started_on = (created_at at time zone 'Europe/Oslo')::date
 where started_on is null and created_at is not null;

create or replace function public.projects_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status_line := nullif(btrim(new.status_line), '');
  new.link_url := nullif(btrim(new.link_url), '');
  if new.status_line is null then
    new.status_line_at := null;
  elsif tg_op = 'INSERT' then
    new.status_line_at := coalesce(new.status_line_at, now());
  elsif new.status_line is distinct from old.status_line then
    -- Changed by this write: stamp it, unless the writer sent its own time.
    if new.status_line_at is not distinct from old.status_line_at or new.status_line_at is null then
      new.status_line_at := now();
    end if;
  elsif new.status_line_at is null then
    new.status_line_at := coalesce(old.status_line_at, now());
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_projects_tidy on public.projects;
create trigger trg_projects_tidy
  before insert or update on public.projects
  for each row execute function public.projects_tidy();

-- A project's tasks follow its area (Personal ↔ Work) — a task the owner
-- filed elsewhere (media) stays.
create or replace function public.projects_area_moves_tasks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.area is distinct from old.area then
    update public.tasks t set domain = new.area
     where t.project_id = new.id and t.domain = old.area;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_projects_area_moves_tasks on public.projects;
-- (created after section C, once tasks.project_id exists)

-- ── B. project_phases ───────────────────────────────────────────────────────
alter table public.project_phases add column if not exists done_when text;
alter table public.project_phases add column if not exists target_on date;
alter table public.project_phases add column if not exists done_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_phases_done_when_check' and conrelid = 'public.project_phases'::regclass) then
    alter table public.project_phases add constraint project_phases_done_when_check
      check (done_when is null or char_length(done_when) <= 1000);
  end if;
end $$;

-- A phase already done was finished when it was last changed.
update public.project_phases
   set done_at = coalesce(updated_at, created_at, now())
 where status = 'done' and done_at is null;

create or replace function public.project_phases_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.done_when := nullif(btrim(new.done_when), '');
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.done_at := coalesce(new.done_at, now());
    elsif old.status is distinct from new.status then
      if new.done_at is not distinct from old.done_at or new.done_at is null then
        new.done_at := now();
      end if;
    elsif new.done_at is null then
      new.done_at := coalesce(old.done_at, now());
    end if;
  else
    new.done_at := null;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_project_phases_tidy on public.project_phases;
create trigger trg_project_phases_tidy
  before insert or update on public.project_phases
  for each row execute function public.project_phases_tidy();

-- ── C. A project's tasks are tasks ──────────────────────────────────────────
alter table public.tasks add column if not exists project_id uuid
  references public.projects(id) on delete cascade;
alter table public.tasks add column if not exists project_phase_id uuid
  references public.project_phases(id) on delete set null;
create index if not exists tasks_project on public.tasks (project_id, sort_order) where project_id is not null;
create index if not exists tasks_project_phase on public.tasks (project_phase_id) where project_phase_id is not null;

create or replace function public.tasks_project_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project uuid;
  v_area    text;
begin
  -- Only what this write changes is checked: a phase's ON DELETE SET NULL
  -- runs while its project is being deleted too, and must pass.
  if new.project_phase_id is not null
     and (tg_op = 'INSERT' or new.project_phase_id is distinct from old.project_phase_id) then
    select ph.project_id into v_project
      from public.project_phases ph
     where ph.id = new.project_phase_id and ph.user_id = new.user_id;
    if v_project is null then
      raise exception 'That phase is not one of your projects.' using errcode = '23503';
    end if;
    new.project_id := v_project;
  elsif new.project_phase_id is not null and new.project_id is distinct from old.project_id
        and not exists (select 1 from public.project_phases ph
                         where ph.id = new.project_phase_id and ph.project_id = new.project_id) then
    -- Moved to another project (or out of one): the old phase stays behind.
    new.project_phase_id := null;
  end if;
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    select p.area into v_area from public.projects p where p.id = new.project_id and p.user_id = new.user_id;
    if v_area is null then
      raise exception 'That project is not yours.' using errcode = '23503';
    end if;
    -- A new task in a project takes its area (a media task stays media). An
    -- existing task linked later (F1 below) keeps its domain.
    if tg_op = 'INSERT' and new.domain in ('personal', 'work') then
      new.domain := v_area;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tasks_project_link on public.tasks;
create trigger trg_tasks_project_link
  before insert or update of project_id, project_phase_id on public.tasks
  for each row
  when (new.project_id is not null or new.project_phase_id is not null)
  execute function public.tasks_project_link();

create trigger trg_projects_area_moves_tasks
  after update of area on public.projects
  for each row execute function public.projects_area_moves_tasks();

-- ── D. project_blocks ───────────────────────────────────────────────────────
create table if not exists public.project_blocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null check (kind in ('table', 'log', 'decisions', 'pages', 'links')),
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  -- A table's columns ({ columns: [{ key, label, type, options? }], groupBy?,
  -- currency? }) — checked by the app (projectModel.ts); the database only
  -- keeps it an object of sane size.
  settings    jsonb not null default '{}'::jsonb
              check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 20000),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.project_blocks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_blocks'
                 and policyname = 'Users manage own project blocks') then
    create policy "Users manage own project blocks" on public.project_blocks for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists project_blocks_user_project on public.project_blocks (user_id, project_id, sort_order);
create index if not exists project_blocks_project on public.project_blocks (project_id);
grant select, insert, update, delete on public.project_blocks to authenticated;

create or replace function public.project_blocks_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.user_id = new.user_id) then
    raise exception 'That project is not yours.' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_project_blocks_tidy on public.project_blocks;
create trigger trg_project_blocks_tidy
  before insert or update on public.project_blocks
  for each row execute function public.project_blocks_tidy();

drop trigger if exists trg_audit on public.project_blocks;
create trigger trg_audit
  after insert or update or delete on public.project_blocks
  for each row execute function public.log_audit();

-- ── E. project_entries ──────────────────────────────────────────────────────
create table if not exists public.project_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  block_id    uuid not null references public.project_blocks(id) on delete cascade,
  title       text check (title is null or char_length(title) <= 300),
  body        text check (body is null or char_length(body) <= 50000),
  url         text check (url is null or (char_length(url) <= 2000 and url ~* '^https?://')),
  entry_date  date,
  state       text check (state is null or state in ('open', 'decided')),
  -- A table row: one key per column of its block.
  data        jsonb not null default '{}'::jsonb
              check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 20000),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.project_entries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_entries'
                 and policyname = 'Users manage own project entries') then
    create policy "Users manage own project entries" on public.project_entries for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
create index if not exists project_entries_user_project on public.project_entries (user_id, project_id, block_id, sort_order);
create index if not exists project_entries_block on public.project_entries (block_id);
grant select, insert, update, delete on public.project_entries to authenticated;

create or replace function public.project_entries_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_project uuid;
begin
  select b.project_id into v_project
    from public.project_blocks b
   where b.id = new.block_id and b.user_id = new.user_id;
  if v_project is null then
    raise exception 'That block is not one of your projects.' using errcode = '23503';
  end if;
  new.project_id := v_project;
  new.title := nullif(btrim(new.title), '');
  new.body := nullif(new.body, '');
  new.url := nullif(btrim(new.url), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_project_entries_tidy on public.project_entries;
create trigger trg_project_entries_tidy
  before insert or update on public.project_entries
  for each row execute function public.project_entries_tidy();

drop trigger if exists trg_audit on public.project_entries;
create trigger trg_audit
  after insert or update or delete on public.project_entries
  for each row execute function public.log_audit();

-- ── F. The old items become tasks ───────────────────────────────────────────
-- 043's cleanup of a deleted item (its slots go, their open tasks close) is
-- switched off: the items are now only a record, deleted with their phase or
-- project — and the tasks made of them below are the project's tasks, which a
-- deleted phase keeps. app_delete_rows reads the same switch, so its Undo
-- stays consistent.
do $$ begin
  if to_regclass('public.link_rules') is not null then
    update public.link_rules set enabled = false where rule_name = 'project_item_delete_cleans_block';
  end if;
end $$;

-- F1. A planned item already has a task: the newest open one, else the
-- newest, becomes the project task. Its notes come along only when the task
-- has none and isn't on Google (a copy there would be a change on Google).
with picked as (
  select distinct on (i.id) i.id as item_id, i.project_id, i.phase_id, i.notes, t.id as task_id
    from public.project_items i
    join public.tasks t on t.source_type = 'project_item' and t.source_id = i.id and t.user_id = i.user_id
   where t.project_id is null
     and not exists (select 1 from public.tasks x where x.source_type = 'project_item' and x.source_id = i.id
                       and x.project_id is not null)
   order by i.id, (t.status in ('open', 'in_progress', 'waiting')) desc, t.created_at desc nulls last, t.id
)
update public.tasks t
   set project_id = p.project_id,
       project_phase_id = p.phase_id,
       description = case when t.description is null and not t.google_sync_enabled then p.notes else t.description end
  from picked p
 where t.id = p.task_id;

-- F2. Every other item becomes an undated Backlog task.
insert into public.tasks (user_id, title, description, domain, section, status, priority, sort_order,
                          source_type, source_id, google_sync_enabled, project_id, project_phase_id,
                          created_at, completed_at)
select i.user_id, i.title, i.notes,
       case when p.area = 'work' then 'work' else 'personal' end,
       'backlog', i.status, i.priority, i.sort_order,
       'project_item', i.id, false, i.project_id, i.phase_id,
       coalesce(i.created_at, now()),
       case when i.status in ('done', 'cancelled') then coalesce(i.updated_at, i.created_at, now()) end
  from public.project_items i
  join public.projects p on p.id = i.project_id
 where not exists (select 1 from public.tasks t where t.source_type = 'project_item' and t.source_id = i.id);

-- ── G. A new project with its template's phases and blocks ──────────────────
-- p_project: { name, description?, kind?, area?, status?, started_on?,
-- target_on?, link_url? }; p_phases: [{ name, done_when? }]; p_blocks:
-- [{ kind, title, settings? }]. Row level security applies (invoker).
create or replace function public.app_create_project(p_project jsonb, p_phases jsonb default '[]'::jsonb, p_blocks jsonb default '[]'::jsonb)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.projects;
  v_name    text := btrim(coalesce(p_project ->> 'name', ''));
  e         jsonb;
  i         integer := 0;
begin
  if v_name = '' then
    raise exception 'A project needs a name.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_phases, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then
    raise exception 'Phases and blocks are lists.' using errcode = '22023';
  end if;
  insert into public.projects (name, description, kind, area, status, started_on, target_on, link_url, sort_order)
  values (left(v_name, 120),
          nullif(btrim(p_project ->> 'description'), ''),
          coalesce(nullif(p_project ->> 'kind', ''), 'blank'),
          coalesce(nullif(p_project ->> 'area', ''), 'personal'),
          coalesce(nullif(p_project ->> 'status', ''), 'active'),
          coalesce(nullif(p_project ->> 'started_on', '')::date, (now() at time zone 'Europe/Oslo')::date),
          nullif(p_project ->> 'target_on', '')::date,
          nullif(btrim(p_project ->> 'link_url'), ''),
          coalesce((select max(x.sort_order) + 1 from public.projects x where x.user_id = (select auth.uid())), 0))
  returning * into v_project;

  for e in select x from jsonb_array_elements(coalesce(p_phases, '[]'::jsonb)) x loop
    continue when btrim(coalesce(e ->> 'name', '')) = '';
    insert into public.project_phases (project_id, name, done_when, sort_order)
    values (v_project.id, left(btrim(e ->> 'name'), 120), nullif(btrim(e ->> 'done_when'), ''), i);
    i := i + 1;
  end loop;

  i := 0;
  for e in select x from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) x loop
    insert into public.project_blocks (project_id, kind, title, settings, sort_order)
    values (v_project.id, e ->> 'kind', left(btrim(coalesce(e ->> 'title', '')), 80),
            case when jsonb_typeof(e -> 'settings') = 'object' then e -> 'settings' else '{}'::jsonb end, i);
    i := i + 1;
  end loop;

  return v_project;
end;
$$;
revoke all on function public.app_create_project(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.app_create_project(jsonb, jsonb, jsonb) to authenticated;

select public.owner_lock_apply('public.project_blocks');
select public.owner_lock_apply('public.project_entries');
