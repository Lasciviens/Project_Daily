-- Migration 161's scenarios (Watching = rewatching), run after 149's own
-- scenarios on the same database (scripts/verify-db-rewatch-start.mjs), so
-- t_ok and the media fixtures are there. Setup runs as the superuser; the
-- app's writes run as `authenticated` under row level security. Every id here
-- starts with 161… so nothing meets 149's fixtures.

-- ── Fixtures ────────────────────────────────────────────────────────────────
reset role;
-- TMDB's data: S1 has 3 episodes, S2 2, a special in S0; S2E2 is the last aired.
insert into public.tv_series (id, tmdb_id, title, metadata_json) values
  ('16100000-0000-0000-0000-00000000000a', 16101, 'Pass under way',
   '{"seasons":[{"season_number":0,"episode_count":1},{"season_number":1,"episode_count":3},{"season_number":2,"episode_count":2}],"last_episode_to_air":{"season_number":2,"episode_number":2}}'),
  ('16100000-0000-0000-0000-00000000000b', 16102, 'New season aired',
   '{"seasons":[{"season_number":1,"episode_count":2},{"season_number":2,"episode_count":1}],"last_episode_to_air":{"season_number":1,"episode_number":2}}'),
  ('16100000-0000-0000-0000-00000000000c', 16103, 'Finished once',
   '{"seasons":[{"season_number":1,"episode_count":2}],"last_episode_to_air":{"season_number":1,"episode_number":2}}'),
  ('16100000-0000-0000-0000-00000000000d', 16104, 'Started again before Watching',
   '{"seasons":[{"season_number":1,"episode_count":2}],"last_episode_to_air":{"season_number":1,"episode_number":2}}'),
  ('16100000-0000-0000-0000-00000000000e', 16105, 'No TMDB data', '{}'),
  ('16100000-0000-0000-0000-00000000000f', 16106, 'Synced from Trakt',
   '{"seasons":[{"season_number":1,"episode_count":1}],"last_episode_to_air":{"season_number":1,"episode_number":1}}');
insert into public.user_tv_entries (id, user_id, tv_series_id, status) values
  ('16110000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-00000000000a', 'watching'),
  ('16110000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-00000000000b', 'completed'),
  ('16110000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-00000000000c', 'completed'),
  ('16110000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-00000000000d', 'completed'),
  ('16110000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-00000000000e', 'completed'),
  ('16110000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000001', '16100000-0000-0000-0000-00000000000f', 'completed');
insert into public.movies (id, tmdb_id, title) values
  ('16120000-0000-0000-0000-00000000000a', 16107, 'Seen once'),
  ('16120000-0000-0000-0000-00000000000b', 16108, 'Seen twice');
-- On the Wishlist: their first watch below makes them Completed (149).
insert into public.user_movie_entries (id, user_id, movie_id, status) values
  ('16130000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '16120000-0000-0000-0000-00000000000a', 'wishlist'),
  ('16130000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', '16120000-0000-0000-0000-00000000000b', 'wishlist');

set role authenticated;
-- A · two full passes long ago; a third under way: S1E1 10 days ago, S1E2 9 days ago.
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at)
select 'episode', '16100000-0000-0000-0000-00000000000a', s, e, d
  from (values (1,1),(1,2),(1,3),(2,1),(2,2)) ep(s, e)
 cross join (values (timestamptz '2018-03-01 20:00+00'), (timestamptz '2020-03-01 20:00+00')) p(d);
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000a', 0, 1, '2019-01-01 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000a', 1, 1, date_trunc('second', now()) - interval '10 days'),
  ('episode', '16100000-0000-0000-0000-00000000000a', 1, 2, date_trunc('second', now()) - interval '9 days');
-- B · its first season watched; TMDB now lists an aired S2E1 nobody watched.
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000b', 1, 1, '2021-01-01 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000b', 1, 2, '2021-01-02 20:00+00');
-- C · finished once; nothing since.
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000c', 1, 1, '2019-01-01 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000c', 1, 2, '2019-01-02 20:00+00');
-- D · finished, then the pilot again 3 days ago (before anyone said Watching).
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000d', 1, 1, '2019-01-01 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000d', 1, 2, '2019-01-02 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000d', 1, 1, date_trunc('second', now()) - interval '3 days');
-- E · no TMDB data: two episodes watched once, one of them twice.
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000e', 1, 1, '2019-01-01 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000e', 1, 1, '2020-01-01 20:00+00'),
  ('episode', '16100000-0000-0000-0000-00000000000e', 1, 2, '2019-01-02 20:00+00');
-- F · watched once.
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000f', 1, 1, '2019-01-01 20:00+00');
-- Movies: one watch, two watches.
insert into public.media_watches (kind, movie_entry_id, watched_at) values
  ('movie', '16130000-0000-0000-0000-00000000000a', '2019-01-01 20:00+00'),
  ('movie', '16130000-0000-0000-0000-00000000000b', '2019-01-01 20:00+00'),
  ('movie', '16130000-0000-0000-0000-00000000000b', '2020-01-01 20:00+00');

-- Each watch was added when it happened (a watch added in the app since a
-- round began counts for it, 149's rule — these are older than that).
-- (149 keeps created_at as it was on an update, so the fixture sets it with triggers off.)
reset role;
set session_replication_role = replica;
update public.media_watches set created_at = coalesce(watched_at, created_at)
 where tv_series_id::text like '16100000-%' or movie_entry_id::text like '16130000-%';
set session_replication_role = origin;
set role authenticated;

do $$ begin
  perform public.t_ok((select bool_and(status = 'completed') from public.user_movie_entries where id::text like '16130000-%'), 'the movies are Completed by their first watch');
end $$;

-- ── 1. The aired regular episodes, by TMDB's data ───────────────────────────
do $$
begin
  perform public.t_ok((select count(*) = 5 from public.media_aired_episodes('16100000-0000-0000-0000-00000000000a')),
    'the aired regular episodes: 3 + 2, the special left out');
  perform public.t_ok((select count(*) = 2 from public.media_aired_episodes('16100000-0000-0000-0000-00000000000b')),
    'an episode TMDB lists but has not aired is not counted (S2E1 of a show whose last aired is S1E2)');
  perform public.t_ok(not public.media_tmdb_known('16100000-0000-0000-0000-00000000000e'), 'no TMDB data is known as such');
  perform public.t_ok(public.media_all_aired_watched('16110000-0000-0000-0000-00000000000a'), 'every aired episode of A has a watch');
  perform public.t_ok(not public.media_all_aired_watched('16110000-0000-0000-0000-00000000000e'), 'a show without TMDB data never counts as all watched');
end $$;

-- ── 2. Start rewatch on a show already on Watching: the pass under way ──────
create temp table t_r (k text primary key, v jsonb);
grant all on t_r to authenticated;
insert into t_r select 'A', public.app_start_rewatch('tv', '16110000-0000-0000-0000-00000000000a');
do $$
declare
  r jsonb := (select v from t_r where k = 'A');
  s1e1 timestamptz := (select max(watched_at) from public.media_watches
                        where tv_series_id = '16100000-0000-0000-0000-00000000000a' and season_number = 1 and episode_number = 1);
begin
  perform public.t_ok((r ->> 'round')::int = 3, 'two full passes before → round 3');
  perform public.t_ok((r ->> 'started_at')::timestamptz = s1e1 and (r ->> 'picked_up')::boolean,
    'the round starts at the pilot''s rewatch 10 days ago (picked up), not now');
  perform public.t_ok((select status = 'watching' and rewatch_round = 3 and rewatch_started_at = s1e1
                         from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000a'), 'the entry holds the round and its start');
  perform public.t_ok(not public.media_rewatch_finished('episode', '16110000-0000-0000-0000-00000000000a'), 'two of five done: not finished');
  perform public.t_ok((select count(*) = 13 from public.media_watches where tv_series_id = '16100000-0000-0000-0000-00000000000a'),
    'no watch was written, moved or removed');
end $$;
-- The rest of the pass, watched now: the round ends by itself (149).
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '16100000-0000-0000-0000-00000000000a', 1, 3, date_trunc('second', now())),
  ('episode', '16100000-0000-0000-0000-00000000000a', 2, 1, date_trunc('second', now())),
  ('episode', '16100000-0000-0000-0000-00000000000a', 2, 2, date_trunc('second', now()));
do $$ begin
  perform public.t_ok((select status = 'completed' and rewatch_round is null from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000a'),
    'the last episode of the round makes it Completed again');
end $$;

-- ── 3. Completed → Watching starts the round by itself ──────────────────────
update public.user_tv_entries set status = 'watching' where id = '16110000-0000-0000-0000-00000000000c';
do $$ begin
  perform public.t_ok((select rewatch_round = 2 and rewatch_started_at >= date_trunc('second', now()) - interval '1 minute'
                         from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000c'),
    'a finished show put on Watching: round 2, from now');
end $$;
update public.user_tv_entries set status = 'watching' where id = '16110000-0000-0000-0000-00000000000d';
do $$ begin
  perform public.t_ok((select rewatch_round = 2 and rewatch_started_at = date_trunc('second', now()) - interval '3 days'
                         from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000d'),
    'a pass begun before Watching was picked: the round starts at that pilot watch');
end $$;
-- A new season aired: plain watching, never a rewatch.
update public.user_tv_entries set status = 'watching' where id = '16110000-0000-0000-0000-00000000000b';
reset role;
update public.tv_series set metadata_json = jsonb_set(metadata_json, '{last_episode_to_air}', '{"season_number":2,"episode_number":1}')
 where id = '16100000-0000-0000-0000-00000000000b';
set role authenticated;
update public.user_tv_entries set status = 'completed' where id = '16110000-0000-0000-0000-00000000000b';
update public.user_tv_entries set status = 'watching' where id = '16110000-0000-0000-0000-00000000000b';
do $$ begin
  perform public.t_ok((select rewatch_round is null and rewatch_started_at is null from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000b'),
    'a show back on Watching because a new season aired is plain watching');
end $$;
-- No TMDB data: no guess.
update public.user_tv_entries set status = 'watching' where id = '16110000-0000-0000-0000-00000000000e';
do $$ begin
  perform public.t_ok((select rewatch_round is null from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000e'),
    'without TMDB data, Watching on a finished show starts no round by itself');
end $$;
insert into t_r select 'E', public.app_start_rewatch('tv', '16110000-0000-0000-0000-00000000000e');
do $$ begin
  perform public.t_ok(((select v from t_r where k = 'E') ->> 'round')::int = 2,
    'Start rewatch without TMDB data: one more than the fewest watches of the watched episodes (1 + 1)');
end $$;
-- Paused, and the Trakt sync, start nothing.
update public.user_tv_entries set status = 'paused' where id = '16110000-0000-0000-0000-00000000000f';
do $$ begin
  perform public.t_ok((select rewatch_round is null from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000f'), 'Completed → Paused starts no round');
end $$;
update public.user_tv_entries set status = 'completed' where id = '16110000-0000-0000-0000-00000000000f';
reset role;
select set_config('app.trakt_sync', 'on', false);
update public.user_tv_entries set status = 'watching' where id = '16110000-0000-0000-0000-00000000000f';
select set_config('app.trakt_sync', '', false);
do $$ begin
  perform public.t_ok((select status = 'watching' and rewatch_round is null from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000f'),
    'a Trakt sync write to Watching starts no round (the sync decides statuses itself)');
end $$;
set role authenticated;
-- Watch again's explicit round still holds (149).
update public.user_tv_entries set status = 'completed' where id = '16110000-0000-0000-0000-00000000000f';
update public.user_tv_entries set status = 'watching', rewatch_round = 5 where id = '16110000-0000-0000-0000-00000000000f';
do $$ begin
  perform public.t_ok((select rewatch_round = 5 from public.user_tv_entries where id = '16110000-0000-0000-0000-00000000000f'), 'an explicit round is kept');
end $$;

-- ── 4. Movies ───────────────────────────────────────────────────────────────
update public.user_movie_entries set status = 'watching' where id = '16130000-0000-0000-0000-00000000000a';
do $$ begin
  perform public.t_ok((select rewatch_round = 2 and rewatch_started_at is not null and repeat_count = 0
                         from public.user_movie_entries where id = '16130000-0000-0000-0000-00000000000a'),
    'a finished movie put on Watching: round 2, its watch kept');
end $$;
insert into t_r select 'M', public.app_start_rewatch('movie', '16130000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.t_ok(((select v from t_r where k = 'M') ->> 'round')::int = 3 and not ((select v from t_r where k = 'M') ->> 'picked_up')::boolean,
    'Watch again on a movie seen twice: round 3, from now');
end $$;

-- ── 5. Only your own titles ─────────────────────────────────────────────────
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    perform public.app_start_rewatch('tv', '16110000-0000-0000-0000-00000000000c');
    perform public.t_ok(false, 'another account''s title is refused');
  exception when sqlstate 'P0002' then
    perform public.t_ok(true, 'another account''s title is refused');
  end;
end $$;
select set_config('test.uid', '', false);
do $$
begin
  begin
    perform public.app_start_rewatch('book', '16110000-0000-0000-0000-00000000000c');
    perform public.t_ok(false, 'an unknown kind is refused');
  exception when sqlstate '22023' then
    perform public.t_ok(true, 'an unknown kind is refused');
  end;
end $$;
