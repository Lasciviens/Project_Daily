-- Migration 210's "before" (scripts/verify-db-task-links.mjs loads it on the live item chain, BEFORE 210): the things a
-- task can link to (stand-ins with the columns 210 reads: id, user_id, the old back-pointer, a wish's status) and the
-- old links as the live data has them — a movie or show label, a slot's episode, shop_items.task_id,
-- wish_items.promoted_task_id, football_plans.task_id — with the awkward cases: two open plans of one movie, one
-- shop task named by two items, a task that already plans a routine, a label naming another account's movie.
-- User 1 is the owner, user 2 another allowed account. Made-up titles only.
create table public.user_movie_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null
);
create table public.shop_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.wish_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'idea' check (status in ('idea', 'planned', 'done', 'dropped')),
  promoted_task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null
);
create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null
);
do $$
declare t text;
begin
  foreach t in array array['user_movie_entries', 'shop_items', 'wish_items', 'games', 'books'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    perform public.owner_lock_apply(format('public.%I', t)::regclass);
  end loop;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'user_tv_entries') then
    alter table public.user_tv_entries enable row level security;
    create policy own on public.user_tv_entries for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
grant select, insert, update, delete on public.user_tv_entries to authenticated;

-- The things (fixed ids, so the scenarios can name them).
insert into public.user_movie_entries (id, user_id, title) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Movie One'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Movie Two'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'Movie of user 2');
insert into public.user_tv_entries (id, user_id, title) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Show One');
insert into public.shop_items (id, user_id, title, created_at) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Lamp', now() - interval '3 days'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Chair (older)', now() - interval '3 days'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Chair (newer)', now() - interval '1 day'),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Strap', now()),
  ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Kettle', now()),
  ('30000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'Item of user 2', now());
insert into public.wish_items (id, user_id, title, status) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Trip to Bergen', 'planned'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Concert', 'idea'),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Museum', 'idea');
insert into public.games (id, user_id, title) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Game One');
insert into public.books (id, user_id, title) values ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Book One');
insert into public.hevy_routines (id, user_id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Push Day'),
  ('aaaaaaaa-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'Routine of user 2');

-- The tasks with the old links.
insert into public.tasks (id, user_id, title, status, source_type, source_id, created_at, hevy_routine_id) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Watch: Movie One (older)', 'open', 'movie', '10000000-0000-0000-0000-000000000001', now() - interval '5 days', null),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Watch: Movie One (newer)', 'open', 'movie', '10000000-0000-0000-0000-000000000001', now() - interval '1 day', null),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Watch: Movie One (watched)', 'done', 'movie', '10000000-0000-0000-0000-000000000001', now() - interval '9 days', null),
  ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Watch: a movie of user 2', 'open', 'movie', '10000000-0000-0000-0000-000000000009', now(), null),
  ('70000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Show One S01E02', 'open', 'tv_series', '20000000-0000-0000-0000-000000000001', now(), null),
  ('70000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Show One S01 (3 ep)', 'open', 'tv_series', '20000000-0000-0000-0000-000000000001', now(), null),
  ('70000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Buy a lamp', 'open', 'manual', null, now(), null),
  ('70000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Buy a chair', 'open', 'manual', null, now(), null),
  ('70000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Push Day', 'open', 'training_session', 'aaaaaaaa-0000-0000-0000-000000000001', now(), 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'Bergen', 'open', 'manual', null, now(), null),
  ('70000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'Concert night', 'done', 'manual', null, now(), null),
  ('70000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', 'Match', 'open', 'manual', null, now(), null),
  ('70000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000001', 'A plain task', 'open', 'manual', null, now(), null);
insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, task_id, source_type, source_id, season_number, episode_number) values
  ('00000000-0000-0000-0000-000000000001', '2026-11-20', 'Show One S01E02', '20:00', 45, '70000000-0000-0000-0000-000000000005', 'tv_episode', '20000000-0000-0000-0000-000000000001', 1, 2),
  ('00000000-0000-0000-0000-000000000001', '2026-11-21', 'Show One S01 (3 ep)', '20:00', 135, '70000000-0000-0000-0000-000000000006', 'tv_episode', '20000000-0000-0000-0000-000000000001', null, null);
update public.shop_items set task_id = '70000000-0000-0000-0000-000000000011' where id = '30000000-0000-0000-0000-000000000001';
update public.shop_items set task_id = '70000000-0000-0000-0000-000000000012' where id in ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');
update public.shop_items set task_id = '70000000-0000-0000-0000-000000000013' where id = '30000000-0000-0000-0000-000000000004';
update public.wish_items set promoted_task_id = '70000000-0000-0000-0000-000000000021' where id = '40000000-0000-0000-0000-000000000001';
-- An owner who put a planned wish back to idea: the move must not flip it.
update public.wish_items set promoted_task_id = '70000000-0000-0000-0000-000000000022' where id = '40000000-0000-0000-0000-000000000002';
insert into public.football_plans (id, user_id, event_id, league, task_id, kickoff_at) values
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '700123', 'nor-1', '70000000-0000-0000-0000-000000000031', '2026-11-29 17:00+00');

create table public.t_before as select id, status, title from public.tasks;
