-- Migration 211's "before" (scripts/verify-db-linked-plans.mjs loads it after 210, on the item chain with
-- task-links/seed.sql): the columns and tables 211's effects read, as stand-ins with the live names — a shop thing's
-- list, kind, status and purchase day; a game's play figures; a movie watch's entry; 149's plan-day rule; the books'
-- reading rows; project phases with 162's tidy rule; Apple Health workouts. Made-up data only.
alter table public.shop_items
  add column if not exists list text not null default 'wishlist',
  add column if not exists kind text not null default 'item',
  add column if not exists status text not null default 'wishlist',
  add column if not exists bought_at timestamptz,
  add column if not exists price numeric,
  add column if not exists currency text;
-- 069's clock on a wish (update_updated_at): the wish effect's undo compares it.
alter table public.wish_items add column if not exists updated_at timestamptz not null default now();
create trigger trg_wish_items_updated_at before update on public.wish_items for each row execute function public.update_updated_at();
alter table public.games
  add column if not exists last_played_at timestamptz,
  add column if not exists play_seconds integer;
alter table public.media_watches
  add column if not exists movie_entry_id uuid references public.user_movie_entries(id) on delete cascade;

-- 149's day a watch counts for (Oslo; an unknown date written in the app = today, one from Trakt none).
create or replace function public.media_watch_plan_day(p_at timestamptz)
returns date language sql stable set search_path = public as $$
  select case
    when p_at >= timestamptz '1971-01-01 00:00:00+00' then (p_at at time zone 'Europe/Oslo')::date
    when not public.trakt_sync_writing() then (now() at time zone 'Europe/Oslo')::date
  end
$$;
grant execute on function public.media_watch_plan_day(timestamptz) to authenticated;

create table public.reading_page_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  page int not null,
  started_at timestamptz not null,
  duration_seconds int not null default 60
);
create table public.project_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  done_at timestamptz,
  updated_at timestamptz
);
-- 162's tidy rule: done_at stamped when the phase is marked done, cleared on reopen.
create or replace function public.project_phases_tidy() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then new.done_at := coalesce(new.done_at, now());
    elsif old.status is distinct from new.status then
      if new.done_at is not distinct from old.done_at or new.done_at is null then new.done_at := now(); end if;
    elsif new.done_at is null then new.done_at := coalesce(old.done_at, now());
    end if;
  else
    new.done_at := null;
  end if;
  return new;
end $$;
create trigger trg_project_phases_tidy before insert or update on public.project_phases for each row execute function public.project_phases_tidy();
alter table public.tasks add column if not exists project_phase_id uuid references public.project_phases(id) on delete set null;

create table public.health_workouts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  start_time timestamptz,
  end_time timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['reading_page_events', 'project_phases', 'health_workouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.reading_page_events_id_seq to authenticated;
alter table public.hevy_workouts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'hevy_workouts') then
    create policy own on public.hevy_workouts for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
grant select on public.hevy_workouts to authenticated;

-- Apple Health rows already there (before 211): a Hevy-written one carrying the device's name, and a Watch walk.
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('hevy-old-1', '00000000-0000-0000-0000-000000000001', 'Push Day', null, '2026-10-01 16:00:00+00', '2026-10-01 17:00:00+00');
insert into public.health_workouts (id, user_id, name, start_time, end_time, raw) values
  ('apple-old-1', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-10-01 16:00:04+00', '2026-10-01 17:05:00+00',
   '{"source": {"name": "Ola Nordmann''s Apple Watch", "identifier": "com.hevyapp.hevy"}}'),
  ('apple-old-2', '00000000-0000-0000-0000-000000000001', 'Outdoor Walk', '2026-10-02 08:00:00+00', '2026-10-02 08:40:00+00',
   '{"source": {"name": "Ola Nordmann''s Apple Watch", "identifier": "com.apple.health.ABC"}}');
