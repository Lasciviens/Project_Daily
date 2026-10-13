-- The shapes migration 144's delete/restore has to handle, as small as they
-- can be (scripts/verify-db-delete-undo.mjs builds a throwaway database from
-- this, the real migration file and scenarios.sql): cascades several levels
-- deep, SET NULL links (one to the same table), the two rules that delete or
-- change rows without a foreign key (043, 107/123), a generated column, a
-- composite key, arrays, a CHECK that rules touch, row level security and a
-- child table the caller may not read.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
grant usage on schema public to authenticated;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null,
  status text not null default 'open',
  parent_task_id uuid references public.tasks(id) on delete set null,
  google_task_id text, google_sync_enabled boolean not null default false,
  due_date date
);
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text, days_of_week int[] not null default '{1}', except_dates date[] not null default '{}'
);
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  task_id uuid references public.tasks(id) on delete cascade,
  schedule_block_id uuid references public.schedule_blocks(id) on delete set null,
  occurrence_date date,
  date date not null, start_time time, title text,
  source_type text not null default 'manual', source_id uuid,
  google_calendar_event_id text
);
create unique index time_blocks_one_per_task on public.time_blocks(task_id) where task_id is not null;
create table public.training_skips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  task_id uuid unique references public.tasks(id) on delete cascade,
  reason text not null
);
create table public.wish_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null,
  promoted_task_id uuid references public.tasks(id) on delete set null
);
-- a composite-key child (no single key: its rows go back, nothing below it is followed)
create table public.task_tags (
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag text not null,
  primary key (task_id, tag)
);
-- a child the caller may not read at all (like the token tables)
create table public.task_secrets (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  secret text
);

create table public.projects (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null);
create table public.project_phases (id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade, name text);
create table public.project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.project_phases(id) on delete cascade,
  title text
);
-- 043: a project item's schedule blocks go with it (by source, no foreign key)
create or replace function public.cleanup_block_on_project_item_delete() returns trigger language plpgsql as $$
begin
  delete from public.time_blocks where source_type = 'project_item' and source_id = old.id;
  return old;
end $$;
create trigger trg_cleanup_block_on_project_item_delete after delete on public.project_items
  for each row execute function public.cleanup_block_on_project_item_delete();

create table public.recipe_ingredient_library (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, kcal numeric);
create table public.recipes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  title text not null, macro_mode text not null default 'manual', calories numeric
);
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  library_ingredient_id uuid references public.recipe_ingredient_library(id) on delete set null,
  name text
);
create table public.food_log_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  recipe_id uuid references public.recipes(id) on delete set null,
  library_ingredient_id uuid references public.recipe_ingredient_library(id) on delete set null,
  custom_title text,
  calories numeric,
  kcal_x2 numeric generated always as (calories * 2) stored,
  constraint has_content check (recipe_id is not null or library_ingredient_id is not null or custom_title is not null)
);
-- 107: a deleted source leaves its name on the diary row
create or replace function public.library_keep_log_title() returns trigger language plpgsql as $$
begin
  update public.food_log_entries set custom_title = old.name where library_ingredient_id = old.id and custom_title is null;
  return old;
end $$;
-- 123: recipes built from a deleted food switch to typed macros
create or replace function public.library_freeze_recipes() returns trigger language plpgsql as $$
begin
  update public.recipes set macro_mode = 'manual'
   where macro_mode = 'from_ingredients'
     and id in (select recipe_id from public.recipe_ingredients where library_ingredient_id = old.id);
  return old;
end $$;
create trigger trg_library_keep_log_title before delete on public.recipe_ingredient_library
  for each row execute function public.library_keep_log_title();
create trigger trg_library_freeze_recipes before delete on public.recipe_ingredient_library
  for each row execute function public.library_freeze_recipes();

-- row level security as the app has it: own rows only
do $$
declare t text;
begin
  foreach t in array array['tasks','schedule_blocks','time_blocks','training_skips','wish_items','projects',
                           'recipe_ingredient_library','recipes','food_log_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  foreach t in array array['project_phases','project_items','recipe_ingredients','task_tags'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on public.task_secrets from authenticated;
