-- Migration 149's scenarios: one row per watch (media_watches), the cache
-- columns that follow them, old writers translated into watches, the
-- per-play Trakt outbox and rewatch rounds. Setup and Trakt-sync writes run
-- as the superuser; the app's writes run as `authenticated` under row level
-- security. Each top-level statement is its own transaction, so the deferred
-- translation (3) has run before the next check.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- What the outbox holds, as "op key" lines in send order.
create or replace function public.t_outbox() returns text language sql security definer as $$
  select coalesce(string_agg(op || ' ' || item_key, ' | ' order by seq), '') from public.trakt_outbox
$$;
grant execute on function public.t_outbox() to authenticated;
create or replace function public.t_payload(p_op text) returns jsonb language sql security definer as $$
  select payload from public.trakt_outbox where op = p_op order by seq limit 1
$$;
grant execute on function public.t_payload(text) to authenticated;
create or replace function public.t_has(p_op text) returns boolean language sql security definer as $$
  select exists (select 1 from public.trakt_outbox where op = p_op)
$$;
grant execute on function public.t_has(text) to authenticated;
create or replace function public.t_count(p_op text) returns int language sql security definer as $$
  select count(*)::int from public.trakt_outbox where op = p_op
$$;
grant execute on function public.t_count(text) to authenticated;
create or replace function public.t_clear() returns void language sql security definer as $$ delete from public.trakt_outbox $$;
grant execute on function public.t_clear() to authenticated;
create table public.t_snap (k text primary key, v jsonb);
grant all on public.t_snap to authenticated;

-- ── 1. Backfill: one watch per play, at the kept date, nothing sent ─────────
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000001') = 3,
    'an episode watched 3 times has 3 watches');
  perform public.t_ok((select bool_and(watched_at = '2026-01-08 20:00:00+00' and source = 'backfill' and trakt_history_id is null)
      from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000001'),
    'all at the kept date (to the second), marked backfill, no Trakt id');
  perform public.t_ok((select watched_at from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000004') = 'epoch',
    'an unknown episode date stays the epoch');
  perform public.t_ok((select count(*) filter (where watched_at is null) from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000001') = 2,
    'a completed movie watched twice on an unknown date has 2 watches with no date');
  perform public.t_ok(not exists (select 1 from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000002'),
    'a wishlist movie has none');
  perform public.t_ok((select count(*) from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000003') = 1,
    'a dropped movie with a watch date has one');
  perform public.t_ok((select count(*) from public.media_watches where user_id = '00000000-0000-0000-0000-000000000002') = 1,
    'another user''s plays are theirs');
  perform public.t_ok((select count(*) from public.media_watches) = 3 + 1 + 2 + 1 + 2 + 1 + 1 + 1,
    'the second run of 149 added nothing');
  perform public.t_ok(public.t_outbox() = '', 'the backfill sent nothing to Trakt');
  perform public.t_ok((select history_synced_at is null from public.trakt_sync_state), 'the next sync reads the whole Trakt history');
end $$;

-- ── 2. The Trakt pull gives E1's watches their real plays (a sync write) ────
begin;
select set_config('request.headers', '{"x-trakt-sync":"1"}', true);
with w as (select id, row_number() over (order by id) n from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000001')
update public.media_watches m set
  trakt_history_id = 1000 + w.n, source = 'trakt',
  watched_at = case w.n when 1 then timestamptz '2018-10-12 20:00:00+00' when 2 then timestamptz '2024-12-01 20:00:00+00' else timestamptz '2026-01-08 20:00:00+00' end
from w where m.id = w.id;
commit;
do $$
begin
  perform public.t_ok(public.t_outbox() = '', 'sync writes queue nothing for Trakt');
  perform public.t_ok((select date_trunc('second', watched_at) = '2026-01-08 20:00:00+00' and repeat_count = 2 from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000001'),
    'the cache keeps the latest watch and plays − 1');
end $$;

-- ── 3. Changing ONE watch's date: that play only, never the whole episode ───
set role authenticated;
update public.media_watches set watched_at = '2025-01-15 12:00:00+00' where trakt_history_id = 1002;
do $$
declare v jsonb;
begin
  perform public.t_ok(public.t_outbox() = 'history_remove_play ep:1399:1:1 | history_add ep:1399:1:1',
    'a new date on one watch = remove that play + add the new one (' || public.t_outbox() || ')');
  v := public.t_payload('history_remove_play');
  perform public.t_ok((v ->> 'history_id')::bigint = 1002 and (v ->> 'watched_at')::timestamptz = '2024-12-01 20:00:00+00',
    'the remove names the old play by its Trakt id and date');
  v := public.t_payload('history_add');
  perform public.t_ok((v ->> 'watched_at')::timestamptz = '2025-01-15 12:00:00+00', 'the add carries the new date');
  perform public.t_ok(not public.t_has('history_remove'), 'no whole-episode remove was queued');
  perform public.t_ok((select count(*) from public.media_watches where trakt_history_id in (1001, 1003)) = 2, 'the other watches keep their plays');
  perform public.t_ok((select trakt_history_id is null and source = 'app' from public.media_watches where watched_at = '2025-01-15 12:00:00+00'),
    'the re-dated watch lost its old Trakt id');
  perform public.t_ok((select date_trunc('second', watched_at) = '2026-01-08 20:00:00+00' and repeat_count = 2 from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000001'),
    'the episode''s kept date is still its latest watch');
end $$;
select public.t_clear();

-- ── 4. Watched again adds a watch and keeps the others ──────────────────────
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at)
values ('episode', '20000000-0000-0000-0000-000000000001', 1, 2, '2026-03-01 12:00:00.789+00');
do $$
begin
  perform public.t_ok(public.t_outbox() = 'history_add ep:1399:1:2', 'one more watch = one history_add (' || public.t_outbox() || ')');
  perform public.t_ok((select count(*) from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000002') = 2, 'the episode has both watches');
  perform public.t_ok((select watched_at = '2026-03-01 12:00:00+00' and repeat_count = 1 from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000002'),
    'the cache moves to the newest watch, plays + 1');
  perform public.t_ok(exists (select 1 from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000002' and watched_at = '2026-01-09 20:00:00+00'),
    'the first watch keeps its date');
end $$;
select public.t_clear();

-- ── 5. Only the sync may link a watch to a Trakt play ───────────────────────
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at, trakt_history_id, source)
values ('episode', '20000000-0000-0000-0000-000000000001', 1, 2, '2026-03-02 12:00:00+00', 777, 'trakt');
update public.media_watches set trakt_history_id = 778 where trakt_history_id = 1001;
do $$
begin
  perform public.t_ok((select trakt_history_id is null and source = 'app' from public.media_watches where watched_at = '2026-03-02 12:00:00+00'),
    'an app insert cannot set trakt_history_id or source');
  perform public.t_ok(exists (select 1 from public.media_watches where trakt_history_id = 1001), 'an app update cannot change it');
end $$;
select public.t_clear();

-- ── 6. Removing one watch removes that play only ────────────────────────────
delete from public.media_watches where id = (select id from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000002' and watched_at = '2026-03-02 12:00:00+00');
do $$
begin
  perform public.t_ok(public.t_outbox() = 'history_remove_play ep:1399:1:2', 'one watch removed = one play removed (' || public.t_outbox() || ')');
  perform public.t_ok((select repeat_count = 1 and watched_at = '2026-03-01 12:00:00+00' from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000002'),
    'the cache follows');
end $$;
select public.t_clear();

-- ── 7. The last watch removed (with Undo): not watched, then back ───────────
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('media_watches', array[(select id::text from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000004')]);
  insert into public.t_snap values ('lastwatch', s);
end $$;
do $$
begin
  perform public.t_ok((select watched_at is null and repeat_count = 0 from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000004'),
    'removing the last watch makes the episode not watched (its row stays for Undo)');
  perform public.t_ok(public.t_outbox() = 'history_remove ep:1399:1:4', 'and removes it on Trakt (' || public.t_outbox() || ')');
end $$;
select public.t_clear();
select public.app_restore_rows((select v from public.t_snap where k = 'lastwatch'));
do $$
begin
  perform public.t_ok((select watched_at = 'epoch' and repeat_count = 0 from public.user_tv_episodes
      where tv_series_id = '20000000-0000-0000-0000-000000000001' and season_number = 1 and episode_number = 4 and user_id = auth.uid()),
    'Undo puts the watch back and the episode is watched again');
  perform public.t_ok(public.t_outbox() = 'history_add ep:1399:1:4', 'and sends that play again (' || public.t_outbox() || ')');
end $$;
select public.t_clear();

-- ── 7b. An undo that puts a watch back before its episode row (150's steps
--        run newest first) waits for the row: never a second episode row ──
do $$
declare w jsonb; e jsonb;
begin
  select to_jsonb(x) into e from public.user_tv_episodes x where id = '22000000-0000-0000-0000-000000000003';
  select jsonb_agg(to_jsonb(x)) into w from public.media_watches x where episode_id = '22000000-0000-0000-0000-000000000003';
  insert into public.t_snap values ('e3', e), ('w3', w);
end $$;
delete from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000003';
select public.t_clear();
do $$
begin
  begin
    insert into public.media_watches select * from jsonb_populate_recordset(null::public.media_watches, (select v from public.t_snap where k = 'w3'));
    perform public.t_ok(false, 'a watch whose episode row is not back yet waits (foreign key error)');
  exception when foreign_key_violation then
    perform public.t_ok(true, 'a watch whose episode row is not back yet waits (foreign key error)');
  end;
  perform public.t_ok(not exists (select 1 from public.user_tv_episodes where tv_series_id = '20000000-0000-0000-0000-000000000001' and season_number = 1 and episode_number = 3 and user_id = auth.uid()),
    'and no episode row was made for it');
end $$;
-- The undo's next round, in its one transaction: the row, then its watches.
begin;
insert into public.user_tv_episodes select * from jsonb_populate_record(null::public.user_tv_episodes, (select v from public.t_snap where k = 'e3'));
insert into public.media_watches select * from jsonb_populate_recordset(null::public.media_watches, (select v from public.t_snap where k = 'w3'));
commit;
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000003') = 2,
    'once the row is back its watches go on it, none doubled');
  perform public.t_ok(public.t_outbox() = 'history_add ep:1399:1:3 | history_add ep:1399:1:3', 'and their plays go to Trakt again, one each (' || public.t_outbox() || ')');
end $$;
select public.t_clear();

-- ── 8. Not watched (the episode row deleted): ONE whole-episode remove ──────
delete from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000001';
do $$
begin
  perform public.t_ok(public.t_outbox() = 'history_remove ep:1399:1:1', 'unmarking removes every play, once (' || public.t_outbox() || ')');
  perform public.t_ok(not exists (select 1 from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000001'), 'its watches went with it');
end $$;
select public.t_clear();

-- ── 9. Old writers (the assistant's db tools, SQL) become watches ───────────
update public.user_tv_episodes set repeat_count = repeat_count + 1, watched_at = '2026-05-05 12:00:00+00'
 where id = '22000000-0000-0000-0000-000000000003';
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000003') = 3,
    'repeat_count + 1 adds one watch');
  perform public.t_ok(exists (select 1 from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000003' and watched_at = '2026-05-05 12:00:00+00'),
    'at the date written');
  perform public.t_ok((select count(*) from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000003' and watched_at = '2026-01-10 20:00:00+00') = 2,
    'the earlier watches keep theirs');
  perform public.t_ok(public.t_outbox() = 'history_add ep:1399:1:3', 'and only that play goes to Trakt (' || public.t_outbox() || ')');
end $$;
select public.t_clear();
update public.user_tv_episodes set repeat_count = 0 where id = '22000000-0000-0000-0000-000000000003';
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where episode_id = '22000000-0000-0000-0000-000000000003') = 1, 'fewer plays remove watches');
  perform public.t_ok((select repeat_count = 0 from public.user_tv_episodes where id = '22000000-0000-0000-0000-000000000003'), 'down to the count written');
  perform public.t_ok(public.t_outbox() = 'history_remove_play ep:1399:1:3 | history_remove_play ep:1399:1:3', 'each one as its own play (' || public.t_outbox() || ')');
  perform public.t_ok(not public.t_has('history_remove'), 'never the whole episode');
end $$;
select public.t_clear();
insert into public.user_tv_episodes (tv_entry_id, tv_series_id, season_number, episode_number, watched_at)
values ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 5, '2026-06-01 12:00:00+00');
update public.user_tv_episodes set watched_at = '2026-06-02 12:00:00+00'
 where tv_series_id = '20000000-0000-0000-0000-000000000001' and season_number = 1 and episode_number = 5 and user_id = auth.uid();
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where season_number = 1 and episode_number = 5 and user_id = auth.uid()) = 1,
    'a watched row inserted the old way gets its first watch');
  perform public.t_ok((select watched_at = '2026-06-02 12:00:00+00' from public.media_watches where season_number = 1 and episode_number = 5 and user_id = auth.uid()),
    'a new date written to the row moves that watch');
  perform public.t_ok(public.t_outbox() = 'history_add ep:1399:1:5 | history_remove_play ep:1399:1:5 | history_add ep:1399:1:5',
    'mark, then re-date one play (' || public.t_outbox() || ')');
end $$;
select public.t_clear();

-- ── 10. Movies ──────────────────────────────────────────────────────────────
update public.user_movie_entries set status = 'completed', watched_at = '2026-07-01 12:00:00+00' where id = '11000000-0000-0000-0000-000000000005';
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000005') = 1,
    'completing a movie gives it its first watch');
  perform public.t_ok(public.t_outbox() = 'watchlist_remove movie:105 | history_add movie:105', 'sent as one play (' || public.t_outbox() || ')');
end $$;
select public.t_clear();
insert into public.media_watches (kind, movie_entry_id, watched_at) values ('movie', '11000000-0000-0000-0000-000000000004', '2026-07-02 12:00:00+00');
update public.media_watches set watched_at = '2023-01-01 12:00:00+00'
 where movie_entry_id = '11000000-0000-0000-0000-000000000004' and watched_at = '2024-05-05 20:00:00+00';
do $$
begin
  perform public.t_ok(public.t_outbox() = 'history_add movie:104 | history_remove_play movie:104 | history_add movie:104',
    'a movie''s watched again and a new date on its first watch touch those plays only (' || public.t_outbox() || ')');
  perform public.t_ok((select repeat_count = 1 and watched_at = '2026-07-02 12:00:00+00' from public.user_movie_entries where id = '11000000-0000-0000-0000-000000000004'),
    'the movie''s cache: latest watch, plays − 1');
end $$;
select public.t_clear();
update public.user_movie_entries set status = 'wishlist', watched_at = null, repeat_count = 0 where id = '11000000-0000-0000-0000-000000000004';
do $$
begin
  perform public.t_ok(not exists (select 1 from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000004'), 'Not watched removes its watches');
  perform public.t_ok(public.t_outbox() = 'history_remove movie:104 | watchlist_add movie:104', 'with ONE movie-wide remove (' || public.t_outbox() || ')');
end $$;
select public.t_clear();
delete from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000001';
do $$
begin
  perform public.t_ok((select status = 'wishlist' and watched_at is null and repeat_count = 0 from public.user_movie_entries where id = '11000000-0000-0000-0000-000000000001'),
    'a completed movie without watches goes back to the Wishlist');
end $$;
insert into public.media_watches (kind, movie_entry_id, watched_at) values ('movie', '11000000-0000-0000-0000-000000000001', null);
do $$
begin
  perform public.t_ok((select status = 'completed' and watched_at is null from public.user_movie_entries where id = '11000000-0000-0000-0000-000000000001'),
    'a watch makes a Wishlist movie Completed (here: on an unknown date)');
end $$;
select public.t_clear();
-- Undo of a deleted movie puts back the entry and its watches once, unlinked from Trakt.
reset role;
update public.media_watches set trakt_history_id = 3003 where movie_entry_id = '11000000-0000-0000-0000-000000000003';
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('user_movie_entries', array['11000000-0000-0000-0000-000000000003']);
  insert into public.t_snap values ('movie', s);
  perform public.t_ok(s::text like '%media_watches%', 'a deleted movie takes its watches along (for Undo)');
end $$;
select public.app_restore_rows((select v from public.t_snap where k = 'movie'));
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000003') = 1,
    'Undo restores its watch once (no second one from the cache)');
  perform public.t_ok((select trakt_history_id is null from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000003'),
    'and unlinks it from the play Trakt removed');
  perform public.t_ok((select status = 'dropped' and repeat_count = 0 from public.user_movie_entries where id = '11000000-0000-0000-0000-000000000003'), 'the entry is as it was');
end $$;
select public.t_clear();

-- Undo of a deleted show: its episodes and every watch come back once each.
do $$
declare s jsonb; n_before int;
begin
  n_before := (select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000001' and user_id = auth.uid());
  insert into public.t_snap values ('show_n', to_jsonb(n_before));
  s := public.app_delete_rows('user_tv_entries', array['21000000-0000-0000-0000-000000000001']);
  insert into public.t_snap values ('show', s);
  perform public.t_ok((select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000001' and user_id = auth.uid()) = 0,
    'a deleted show takes its episodes and their watches along');
end $$;
select public.t_clear();
select public.app_restore_rows((select v from public.t_snap where k = 'show'));
do $$
begin
  perform public.t_ok((select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000001' and user_id = auth.uid())
      = (select (v #>> '{}')::int from public.t_snap where k = 'show_n'), 'Undo brings every watch back, none doubled');
  perform public.t_ok(public.t_count('history_add') = (select (v #>> '{}')::int from public.t_snap where k = 'show_n'),
    'and sends each watch to Trakt again at its own date');
end $$;
select public.t_clear();

-- ── 11. Trakt sync writes ───────────────────────────────────────────────────
reset role;
begin;
select set_config('request.headers', '{"x-trakt-sync":"1"}', true);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at, trakt_history_id, source)
values ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000002', 2, 1, '2026-08-01 12:00:00+00', 2001, 'trakt');
-- The summary's write for a new episode (plays 2): placeholders the history pull replaces.
insert into public.user_tv_episodes (user_id, tv_entry_id, tv_series_id, season_number, episode_number, watched_at, repeat_count)
values ('00000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 2, 2, '2026-08-02 12:00:00+00', 1);
commit;
do $$
begin
  perform public.t_ok(public.t_outbox() = '', 'nothing from the sync goes back to Trakt');
  perform public.t_ok((select trakt_history_id = 2001 and source = 'trakt' from public.media_watches where season_number = 2 and episode_number = 1),
    'the sync keeps the play''s Trakt id');
  perform public.t_ok((select count(*) = 2 and bool_and(source = 'backfill') from public.media_watches where season_number = 2 and episode_number = 2),
    'a summary write becomes placeholder watches');
  perform public.t_ok((select current_episode = 2 and current_season = 2 from public.user_tv_entries where id = '21000000-0000-0000-0000-000000000002'),
    'the show''s progress cache follows (050)');
end $$;
do $$
begin
  perform set_config('app.trakt_sync', 'on', true);
  begin
    insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at, trakt_history_id)
    values ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000002', 2, 1, '2026-08-03 12:00:00+00', 2001);
    perform public.t_ok(false, 'a Trakt play is linked to one watch only');
  exception when unique_violation then
    perform public.t_ok(true, 'a Trakt play is linked to one watch only');
  end;
end $$;

-- ── 12. Guards ──────────────────────────────────────────────────────────────
set role authenticated;
do $$
begin
  begin
    insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at)
    values ('episode', '20000000-0000-0000-0000-000000000099', 1, 1, now());
    perform public.t_ok(false, 'a watch needs the show in the library');
  exception when foreign_key_violation then
    perform public.t_ok(true, 'a watch needs the show in the library');
  end;
  begin
    insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at)
    values ('00000000-0000-0000-0000-000000000002', 'episode', '20000000-0000-0000-0000-000000000001', 1, 1, now());
    perform public.t_ok(false, 'a watch for another account is refused');
  exception when insufficient_privilege or check_violation then
    perform public.t_ok(true, 'a watch for another account is refused');
  end;
  perform public.t_ok((select count(*) from public.media_watches where user_id = '00000000-0000-0000-0000-000000000002') = 0,
    'another account''s watches are not visible');
end $$;
select public.t_clear();

-- ── 13. Rewatching ──────────────────────────────────────────────────────────
reset role;
insert into public.tv_series (id, tmdb_id, title) values ('20000000-0000-0000-0000-000000000003', 1500, 'Rewatch show');
insert into public.user_tv_entries (id, user_id, tv_series_id, status) values
  ('21000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'completed');
set role authenticated;
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at) values
  ('episode', '20000000-0000-0000-0000-000000000003', 1, 1, '2020-01-01 12:00:00+00'),
  ('episode', '20000000-0000-0000-0000-000000000003', 1, 2, '2020-01-02 12:00:00+00'),
  ('episode', '20000000-0000-0000-0000-000000000003', 0, 1, '2020-01-03 12:00:00+00');
update public.user_tv_entries set status = 'watching', rewatch_round = 2 where id = '21000000-0000-0000-0000-000000000003';
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at)
values ('episode', '20000000-0000-0000-0000-000000000003', 1, 1, '2026-09-01 12:00:00+00');
do $$
begin
  perform public.t_ok((select status = 'watching' and rewatch_round = 2 from public.user_tv_entries where id = '21000000-0000-0000-0000-000000000003'),
    'a rewatching show stays Watching while the round is under way');
end $$;
insert into public.media_watches (kind, tv_series_id, season_number, episode_number, watched_at)
values ('episode', '20000000-0000-0000-0000-000000000003', 1, 2, '2026-09-02 12:00:00+00');
do $$
begin
  perform public.t_ok((select status = 'completed' and rewatch_round is null from public.user_tv_entries where id = '21000000-0000-0000-0000-000000000003'),
    'the watch that finishes round 2 (specials aside) makes it Completed again');
end $$;
update public.user_tv_entries set status = 'paused', rewatch_round = 3 where id = '21000000-0000-0000-0000-000000000003';
do $$ begin perform public.t_ok((select rewatch_round = 3 from public.user_tv_entries where id = '21000000-0000-0000-0000-000000000003'), 'a paused rewatch keeps its round'); end $$;
update public.user_tv_entries set status = 'dropped' where id = '21000000-0000-0000-0000-000000000003';
do $$ begin perform public.t_ok((select rewatch_round is null from public.user_tv_entries where id = '21000000-0000-0000-0000-000000000003'), 'leaving Watching ends the round'); end $$;
update public.user_movie_entries set status = 'watching', rewatch_round = 2 where id = '11000000-0000-0000-0000-000000000005';
do $$ begin perform public.t_ok((select count(*) = 1 from public.media_watches where movie_entry_id = '11000000-0000-0000-0000-000000000005'), 'a movie rewatch keeps its watches'); end $$;
insert into public.media_watches (kind, movie_entry_id, watched_at) values ('movie', '11000000-0000-0000-0000-000000000005', '2026-09-05 12:00:00+00');
do $$
begin
  perform public.t_ok((select status = 'completed' and rewatch_round is null and repeat_count = 1 from public.user_movie_entries where id = '11000000-0000-0000-0000-000000000005'),
    'a movie''s second watch finishes its rewatch');
  perform public.t_ok(not public.t_has('history_remove') and not public.t_has('watchlist_add'), 'a rewatch round changes nothing on Trakt but the new plays');
end $$;
reset role;

-- ── 14. "Undo this save" (150) runs through these triggers: single plays ───
create table public.t_tx (k text primary key, tx bigint);
grant all on public.t_tx to authenticated;
-- Preview, then apply with the preview's fingerprint (what the Activity sheet does).
create or replace function public.t_undo(p_k text) returns jsonb language plpgsql as $$
declare p jsonb; tx bigint := (select tx from public.t_tx where k = p_k);
begin
  p := public.app_undo_transaction(tx);
  return public.app_undo_transaction(tx, true, p ->> 'confirm');
end $$;
grant execute on function public.t_undo(text) to authenticated;
create or replace function public.t_has_remove_all() returns boolean language sql security definer as $$
  select exists (select 1 from public.trakt_outbox where op = 'history_remove')
$$;
grant execute on function public.t_has_remove_all() to authenticated;

reset role;
insert into public.tv_series (id, tmdb_id, title) values ('20000000-0000-0000-0000-000000000005', 1600, 'Undo show');
insert into public.user_tv_entries (id, user_id, tv_series_id, status) values
  ('21000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'completed');
begin;
select set_config('app.trakt_sync', 'on', true);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at, trakt_history_id, source) values
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000005', 1, 1, '2018-10-12 20:00+00', 5001, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000005', 1, 1, '2024-12-01 20:00+00', 5002, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000005', 1, 1, '2026-01-08 20:00+00', 5003, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000005', 1, 2, '2018-10-13 20:00+00', 5004, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000005', 1, 2, '2026-01-09 20:00+00', 5005, 'trakt'),
  ('00000000-0000-0000-0000-000000000001', 'episode', '20000000-0000-0000-0000-000000000005', 1, 3, '2018-10-14 20:00+00', 5006, 'trakt');
commit;
create table public.t_watch_dates as select id, watched_at from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000005';
grant select on public.t_watch_dates to authenticated;
select public.t_clear();
set role authenticated;

-- a) The incident's save, replayed: the latest watch of three episodes re-dated at once.
do $$
begin
  update public.media_watches set watched_at = '2026-10-14 12:00+00'
   where id in (select distinct on (episode_id) id from public.media_watches
                 where tv_series_id = '20000000-0000-0000-0000-000000000005' order by episode_id, watched_at desc);
  insert into public.t_tx values ('redate', txid_current());
end $$;
do $$ begin perform public.t_ok(public.t_count('history_remove_play') = 3 and public.t_count('history_add') = 3 and not public.t_has_remove_all(),
  'the save sent three single plays out and in, nothing else'); end $$;
select public.t_clear();
do $$
declare r jsonb;
begin
  r := public.t_undo('redate');
  perform public.t_ok((r ->> 'applied')::boolean, 'the save is undone');
  perform public.t_ok(not exists (select 1 from public.media_watches m join public.t_watch_dates b using (id) where m.watched_at is distinct from b.watched_at),
    'every watch has its own old date back');
end $$;
do $$
begin
  perform public.t_ok(public.t_count('history_remove_play') = 3 and public.t_count('history_add') = 3,
    'the undo moves the same three plays back, one by one (' || public.t_outbox() || ')');
  perform public.t_ok(not public.t_has_remove_all(), 'and never removes an episode''s whole history');
  perform public.t_ok((select date_trunc('second', watched_at) = '2026-01-08 20:00:00+00' and repeat_count = 2 from public.user_tv_episodes
      where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 1), 'the cache follows');
end $$;
select public.t_clear();

-- b) Removing an episode's last watch, undone.
do $$
begin
  delete from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 3;
  insert into public.t_tx values ('lastwatch', txid_current());
end $$;
select public.t_clear();
do $$
begin
  perform public.t_ok((public.t_undo('lastwatch') ->> 'applied')::boolean, 'removing the last watch is undone');
  perform public.t_ok((select watched_at = '2018-10-14 20:00+00' from public.user_tv_episodes where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 3),
    'the episode is watched again on its date');
end $$;
do $$ begin perform public.t_ok(public.t_outbox() = 'history_add ep:1600:1:3', 'and only that play goes back to Trakt (' || public.t_outbox() || ')'); end $$;
select public.t_clear();

-- c) Not watched (the episode row and its watches deleted), undone.
do $$
begin
  delete from public.user_tv_episodes where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 2;
  insert into public.t_tx values ('unmark', txid_current());
end $$;
select public.t_clear();
do $$
begin
  perform public.t_ok((public.t_undo('unmark') ->> 'applied')::boolean, 'Not watched is undone');
  perform public.t_ok((select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 2) = 2
    and (select count(*) from public.user_tv_episodes where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 2) = 1,
    'the episode and both its watches are back, none doubled');
end $$;
do $$ begin perform public.t_ok(public.t_count('history_add') = 2 and not public.t_has_remove_all() and public.t_count('history_remove_play') = 0,
  'each watch goes back to Trakt as its own play (' || public.t_outbox() || ')'); end $$;
select public.t_clear();

-- d) The assistant's old-style rewatch (repeat_count + 1), undone.
do $$
begin
  update public.user_tv_episodes set repeat_count = repeat_count + 1, watched_at = '2026-10-10 12:00+00'
   where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 1;
  insert into public.t_tx values ('legacy', txid_current());
end $$;
do $$ begin perform public.t_ok(public.t_outbox() = 'history_add ep:1600:1:1', 'the old-style rewatch was one new play'); end $$;
select public.t_clear();
do $$
begin
  perform public.t_ok((public.t_undo('legacy') ->> 'applied')::boolean, 'the old-style rewatch is undone');
  perform public.t_ok((select count(*) from public.media_watches where tv_series_id = '20000000-0000-0000-0000-000000000005' and episode_number = 1) = 3,
    'the added watch is gone, the three real ones stay');
end $$;
do $$ begin perform public.t_ok(public.t_outbox() = 'history_remove_play ep:1600:1:1', 'only that play leaves Trakt again (' || public.t_outbox() || ')'); end $$;
reset role;
