-- Migration 216 (a done movie plan is a watch, sent to Trakt; undone once on reopen or cancel) on the item chain with
-- 210, 211 and the REAL 149 / 161 / 184, after 216 ran twice and 211's own scenarios ran (scripts/verify-db-media-tick.mjs).
-- Setup and checks run as the superuser (a writer without row security, as the service role is); app writes as
-- `authenticated` (test.uid picks the caller: unset = the owner, user 2 = another allowed account); the Google Tasks
-- pull as the service role (test.uid 'none'). The owner has Trakt connected (its outbox queues), user 2 has not.
-- Movie entries b1… are made here; made-up titles only.
create or replace function public.mt_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.mt_ok(boolean, text) to authenticated, service_role;
create table public.mt_keep (k text primary key, v jsonb);
grant all on public.mt_keep to authenticated, service_role;
create or replace function public.mt_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'written';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.mt_refused(text) to authenticated;
-- A plan of a movie on a day (the item screen's save with its link, 210).
create or replace function public.mt_plan(p_k text, p_title text, p_entry uuid, p_date date default date '2026-11-28') returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.app_save_item(jsonb_build_object('title', p_title, 'domain', 'personal', 'priority', 'medium', 'date', p_date::text,
         'time', '19:00', 'durationMinutes', 60, 'google', 'none', 'today', '2026-11-25'),
       jsonb_build_object('kind', 'movie', 'id', p_entry::text));
  insert into public.mt_keep values (p_k, r) on conflict (k) do update set v = excluded.v;
  return (r ->> 'taskId')::uuid;
end $$;
grant execute on function public.mt_plan(text, text, uuid, date) to authenticated;
create or replace function public.mt_id(p_k text) returns uuid language sql as $$
  select (v ->> 'taskId')::uuid from public.mt_keep where k = p_k
$$;
grant execute on function public.mt_id(text) to authenticated, service_role;
create or replace function public.mt_task(p uuid) returns public.tasks language sql security definer set search_path = '' as $$
  select * from public.tasks where id = p
$$;
grant execute on function public.mt_task(uuid) to authenticated, service_role;
create or replace function public.mt_set(p_task uuid, p_status text) returns void language sql as $$
  update public.tasks set status = p_status where id = p_task
$$;
grant execute on function public.mt_set(uuid, text) to authenticated;
-- What the checks read, as the superuser sees it (outbox and ledger are not the browser's).
create or replace function public.mt_movie(p uuid) returns public.user_movie_entries language sql security definer set search_path = '' as $$
  select * from public.user_movie_entries where id = p
$$;
grant execute on function public.mt_movie(uuid) to authenticated, service_role;
create or replace function public.mt_watches(p uuid) returns setof public.media_watches language sql security definer set search_path = '' as $$
  select * from public.media_watches where movie_entry_id = p order by watched_at nulls first, created_at
$$;
grant execute on function public.mt_watches(uuid) to authenticated, service_role;
create or replace function public.mt_effect(p_task uuid) returns public.task_link_effects language sql security definer set search_path = '' as $$
  select * from public.task_link_effects where task_id = p_task and effect = 'movie_watched'
$$;
grant execute on function public.mt_effect(uuid) to authenticated, service_role;
create or replace function public.mt_outbox(p_op text, p_tmdb integer) returns setof public.trakt_outbox language sql security definer set search_path = '' as $$
  select * from public.trakt_outbox where op = p_op and item_key = 'movie:' || p_tmdb order by seq
$$;
grant execute on function public.mt_outbox(text, integer) to authenticated, service_role;
create or replace function public.mt_clear() returns void language sql security definer set search_path = '' as $$
  delete from public.trakt_outbox
$$;
grant execute on function public.mt_clear() to authenticated, service_role;

-- ── The library (superuser: no outbox noise counted — cleared below) ────────
update public.trakt_sync_state set history_synced_at = now() where user_id = '00000000-0000-0000-0000-000000000001';
insert into public.movies (id, tmdb_id, title) values
  ('b0000000-0000-0000-0000-000000000001', 9101, 'Dune'),
  ('b0000000-0000-0000-0000-000000000002', 9102, 'Arrival'),
  ('b0000000-0000-0000-0000-000000000003', 9103, 'Heat'),
  ('b0000000-0000-0000-0000-000000000004', 9104, 'Alien'),
  ('b0000000-0000-0000-0000-000000000005', 9105, 'Brazil'),
  ('b0000000-0000-0000-0000-000000000006', 9106, 'Tenet'),
  ('b0000000-0000-0000-0000-000000000007', 9107, 'Ran'),
  ('b0000000-0000-0000-0000-000000000008', 9108, 'Solaris'),
  ('b0000000-0000-0000-0000-000000000009', 9109, 'Stalker'),
  ('b0000000-0000-0000-0000-000000000010', 9110, 'Paprika'),
  ('b0000000-0000-0000-0000-000000000011', 9111, 'Persona'),
  ('b0000000-0000-0000-0000-000000000012', 9112, 'Vertigo');
insert into public.user_movie_entries (id, user_id, title, movie_id, status) values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Dune', 'b0000000-0000-0000-0000-000000000001', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Heat', 'b0000000-0000-0000-0000-000000000003', 'dropped'),
  ('b1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Alien', 'b0000000-0000-0000-0000-000000000004', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Brazil', 'b0000000-0000-0000-0000-000000000005', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Tenet', 'b0000000-0000-0000-0000-000000000006', 'upcoming'),
  ('b1000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Ran', 'b0000000-0000-0000-0000-000000000007', 'watching'),
  ('b1000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Solaris', 'b0000000-0000-0000-0000-000000000008', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'Stalker', 'b0000000-0000-0000-0000-000000000009', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Paprika', 'b0000000-0000-0000-0000-000000000010', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Persona', 'b0000000-0000-0000-0000-000000000011', 'wishlist'),
  ('b1000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Vertigo', 'b0000000-0000-0000-0000-000000000012', 'wishlist');
-- Arrival: seen once in 2024, that play linked to Trakt (the sync's write: one transaction, nothing queued).
begin;
set local app.trakt_sync = 'on';
insert into public.user_movie_entries (id, user_id, title, movie_id, status, watched_at) values
  ('b1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Arrival', 'b0000000-0000-0000-0000-000000000002', 'completed', '2024-05-05 20:00+00');
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at, trakt_history_id, source) values
  ('00000000-0000-0000-0000-000000000001', 'movie', 'b1000000-0000-0000-0000-000000000002', '2024-05-05 20:00+00', 5001, 'trakt');
commit;
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000002')) = 1, 'setup: Arrival has its one 2024 watch, linked to Trakt');
select mt_clear();

-- ═══ T. A tick is a watch, dated at the tick, sent to Trakt — once ═══════════
set role authenticated;
select mt_plan('dune', 'Watch: Dune', 'b1000000-0000-0000-0000-000000000001');
select mt_set(mt_id('dune'), 'done');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000001')) = 1
        and (select watched_at = date_trunc('second', (mt_task(mt_id('dune'))).completed_at) and source = 'app' and trakt_history_id is null
               from mt_watches('b1000000-0000-0000-0000-000000000001')),
  'T1 Daily''s tick (a row''s update as the owner): one watch of the movie, dated at the tick (to the second), an app watch');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000001')).status = 'completed'
        and (mt_movie('b1000000-0000-0000-0000-000000000001')).watched_at = (select watched_at from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (mt_movie('b1000000-0000-0000-0000-000000000001')).repeat_count = 0,
  'T1 the movie is Completed with that date, as the Media page''s watch leaves it (149''s cache)');
select mt_ok((select count(*) from mt_outbox('history_add', 9101)) = 1
        and (select payload ->> 'watch_id' from mt_outbox('history_add', 9101)) = (select id::text from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (select (payload ->> 'watched_at')::timestamptz from mt_outbox('history_add', 9101)) = (select watched_at from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (select count(*) from mt_outbox('watchlist_remove', 9101)) = 1,
  'T1 Trakt gets that one play at its own date (history_add, the existing outbox), and the film leaves the watchlist');
select mt_ok((mt_effect(mt_id('dune'))).after ->> 'watch_id' = (select id::text from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (mt_effect(mt_id('dune'))).before ->> 'status' = 'wishlist' and (mt_effect(mt_id('dune'))).after ->> 'status' = 'completed'
        and (mt_effect(mt_id('dune'))).target_id = 'b1000000-0000-0000-0000-000000000001',
  'T1 the ledger names the watch, the movie and its status before and after (the browser reads it for the toast)');
select mt_set(mt_id('dune'), 'done');
update public.tasks set completed_at = completed_at + interval '1 minute', title = 'Watch: Dune (echo)' where id = mt_id('dune');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000001')) = 1
        and (select count(*) from mt_outbox('history_add', 9101)) = 1,
  'T2 a second tick, a retry and a later write of the done task add nothing: one watch, one play queued');

-- ═══ U. Untick: only the tick's watch goes, the status comes back ════════════
select mt_clear();
select mt_set(mt_id('dune'), 'open');
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (mt_movie('b1000000-0000-0000-0000-000000000001')).status = 'wishlist'
        and (mt_movie('b1000000-0000-0000-0000-000000000001')).watched_at is null
        and (mt_effect(mt_id('dune'))).task_id is null,
  'U1 reopened: the watch is gone, the movie back on Wishlist, the ledger forgets it');
select mt_ok((select count(*) from mt_outbox('history_remove_play', 9101)) = 1
        and (select payload ->> 'history_id' from mt_outbox('history_remove_play', 9101)) is null
        and not exists (select 1 from mt_outbox('history_remove', 9101)),
  'U1 Trakt loses that one play (history_remove_play by its watch; the drain cancels it against the add not sent yet) — never the whole movie');
-- The owner's own later status is never undone.
select mt_set(mt_id('dune'), 'done');
update public.user_movie_entries set status = 'dropped' where id = 'b1000000-0000-0000-0000-000000000001';
select mt_set(mt_id('dune'), 'open');
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (mt_movie('b1000000-0000-0000-0000-000000000001')).status = 'dropped',
  'U2 the owner set Dropped after the tick: the untick removes its watch and keeps the owner''s Dropped');

-- Re-dated by the owner (the Media page's date change): the watch is the owner's now.
select mt_plan('brazil', 'Watch: Brazil', 'b1000000-0000-0000-0000-000000000005');
select mt_set(mt_id('brazil'), 'done');
update public.media_watches set watched_at = '2026-11-20 21:00+01' where movie_entry_id = 'b1000000-0000-0000-0000-000000000005';
select mt_clear();
select mt_set(mt_id('brazil'), 'open');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000005')) = 1
        and (select watched_at from mt_watches('b1000000-0000-0000-0000-000000000005')) = '2026-11-20 21:00+01'
        and (mt_movie('b1000000-0000-0000-0000-000000000005')).status = 'completed'
        and not exists (select 1 from mt_outbox('history_remove_play', 9105))
        and (mt_effect(mt_id('brazil'))).task_id is null,
  'U3 the owner re-dated the tick''s watch: the untick leaves it and the Completed status (nothing to Trakt), and forgets the effect');
-- A film watched on another day (the owner's 20th) ticked again: a rewatch. Deleted by the owner before the untick:
-- nothing of the tick's is left to undo.
select mt_set(mt_id('brazil'), 'done');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000005')) = 2
        and (mt_movie('b1000000-0000-0000-0000-000000000005')).repeat_count = 1,
  'U4 ticked again (the film''s only watch is on another day): a second watch, counted (×2)');
delete from public.media_watches where id = ((mt_effect(mt_id('brazil'))).after ->> 'watch_id')::uuid;
select mt_set(mt_id('brazil'), 'open');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000005')) = 1
        and (select watched_at from mt_watches('b1000000-0000-0000-0000-000000000005')) = '2026-11-20 21:00+01'
        and (mt_movie('b1000000-0000-0000-0000-000000000005')).status = 'completed',
  'U4 the owner removed the tick''s watch first: the untick finds nothing of its own and changes nothing');

-- ═══ C. Cancel, a cancelled task, a task with no movie ═══════════════════════
select mt_plan('heat', 'Watch: Heat', 'b1000000-0000-0000-0000-000000000003');
select mt_set(mt_id('heat'), 'cancelled');
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000003'))
        and (mt_movie('b1000000-0000-0000-0000-000000000003')).status = 'dropped',
  'C1 a movie plan cancelled (never done): no watch, the movie as it was');
select mt_set(mt_id('heat'), 'open');
select mt_clear();
select mt_set(mt_id('heat'), 'done');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000003')) = 1
        and (mt_movie('b1000000-0000-0000-0000-000000000003')).status = 'completed'
        and not exists (select 1 from mt_outbox('watchlist_add', 9103)) and not exists (select 1 from mt_outbox('watchlist_remove', 9103)),
  'C2 a Dropped film''s plan ticked: watched and Completed, as the Media page''s Completed does (no watchlist change)');
select mt_set(mt_id('heat'), 'cancelled');
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000003'))
        and (mt_movie('b1000000-0000-0000-0000-000000000003')).status = 'dropped'
        and (select count(*) from mt_outbox('history_remove_play', 9103)) = 1
        and not exists (select 1 from mt_outbox('history_remove', 9103))
        and not exists (select 1 from mt_outbox('watchlist_add', 9103)) and not exists (select 1 from mt_outbox('watchlist_remove', 9103)),
  'C3 done, then cancelled: the watch goes (one play off Trakt) and Dropped comes back, with no watchlist churn on Trakt');
reset role;
insert into public.mt_keep values ('plain', jsonb_build_object('taskId', gen_random_uuid()));
-- (A movie label from an old writer becomes the link under 210, so a task with no link names no movie at all.)
insert into public.tasks (id, user_id, title) values (mt_id('plain'), '00000000-0000-0000-0000-000000000001', 'Watch Persona tonight');
create table public.mt_n as select count(*) as n from public.media_watches;
set role authenticated;
select mt_set(mt_id('plain'), 'done');
reset role;
select mt_ok((select count(*) from public.media_watches) = (select n from public.mt_n)
        and not exists (select 1 from public.task_link_effects where task_id = mt_id('plain')),
  'C4 a task with no movie link (a title naming a film) ticked: no watch anywhere, nothing in the ledger');

-- ═══ D. No double watch: a watch that is the record already ══════════════════
-- The owner marked it on Trakt (today, Oslo) and the sync brought it in before the tick.
select mt_clear();
set role authenticated;
select mt_plan('alien', 'Watch: Alien', 'b1000000-0000-0000-0000-000000000004', (now() at time zone 'Europe/Oslo')::date);
reset role;
begin;
set local app.trakt_sync = 'on';
-- An hour before now on the same Oslo day (from before the plan was made, so 211 leaves the plan open).
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at, trakt_history_id, source) values
  ('00000000-0000-0000-0000-000000000001', 'movie', 'b1000000-0000-0000-0000-000000000004',
   greatest(now() - interval '1 hour', ((now() at time zone 'Europe/Oslo')::date + time '00:00:01') at time zone 'Europe/Oslo'), 6001, 'trakt');
commit;
select mt_ok((mt_task(mt_id('alien'))).status = 'open', 'D1 setup: a Trakt watch from before the plan was made leaves it open (211)');
set role authenticated;
select mt_set(mt_id('alien'), 'done');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000004')) = 1
        and (mt_effect(mt_id('alien'))).task_id is null
        and not exists (select 1 from mt_outbox('history_add', 9104)),
  'D1 the film already has a watch on the tick''s day (marked on Trakt, synced): no second watch, nothing to Trakt, nothing to undo');
select mt_set(mt_id('alien'), 'open');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000004')) = 1,
  'D1 its untick leaves the Trakt watch alone');
-- A watch closes the plan itself (the Media page, or the sync): 211's rule; the tick's effect adds none.
select mt_plan('vertigo', 'Watch: Vertigo', 'b1000000-0000-0000-0000-000000000012', (now() at time zone 'Europe/Oslo')::date);
-- (Two seconds on: a watch is kept to the second, and one from before the plan was made closes nothing.)
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'movie', 'b1000000-0000-0000-0000-000000000012', now() + interval '2 seconds');
select mt_ok((mt_task(mt_id('vertigo'))).status = 'done'
        and (select count(*) from mt_watches('b1000000-0000-0000-0000-000000000012')) = 1
        and (mt_effect(mt_id('vertigo'))).task_id is null,
  'D2 a watch written on the Media page closes its plan (211): still one watch — the plan closed by a record writes none');
select mt_set(mt_id('vertigo'), 'open');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000012')) = 1,
  'D2 reopening that plan keeps the owner''s watch (the tick wrote nothing)');

-- The Trakt sync's echo of our own pushed watch: linked by the sync, never a second row.
select mt_plan('paprika', 'Watch: Paprika', 'b1000000-0000-0000-0000-000000000010');
select mt_set(mt_id('paprika'), 'done');
reset role;
insert into public.mt_keep values ('paprika_watch', jsonb_build_object('id', (select id from mt_watches('b1000000-0000-0000-0000-000000000010'))));
select mt_clear();
begin;
set local app.trakt_sync = 'on';
update public.media_watches set trakt_history_id = 7001, source = 'trakt'
 where id = (select (v ->> 'id')::uuid from public.mt_keep where k = 'paprika_watch');
commit;
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000010')) = 1
        and (select trakt_history_id = 7001 and source = 'app' from mt_watches('b1000000-0000-0000-0000-000000000010'))
        and not exists (select 1 from public.trakt_outbox),
  'E1 the sync links its echo of our play to the tick''s watch: one row, still an app watch, nothing queued back');
set app.trakt_sync = 'on';
select mt_ok(mt_refused($$insert into public.media_watches (user_id, kind, movie_entry_id, watched_at, trakt_history_id, source) values
    ('00000000-0000-0000-0000-000000000001', 'movie', 'b1000000-0000-0000-0000-000000000010', now(), 7001, 'trakt')$$) like '23505%',
  'E1 the same Trakt play can never come in as a second watch (one row per play id)');
reset app.trakt_sync;
set role authenticated;
select mt_set(mt_id('paprika'), 'open');
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000010'))
        and (select payload ->> 'history_id' from mt_outbox('history_remove_play', 9110)) = '7001',
  'E2 unticked after the sync linked it: the watch goes, and Trakt''s remove names that play by the id only the sync wrote');

-- ═══ S. The movie's status comes back exactly ════════════════════════════════
select mt_plan('tenet', 'Watch: Tenet', 'b1000000-0000-0000-0000-000000000006');
select mt_set(mt_id('tenet'), 'done');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000006')).status = 'completed', 'S1 an Upcoming film''s plan ticked: Completed');
select mt_set(mt_id('tenet'), 'open');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000006')).status = 'upcoming'
        and not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000006')),
  'S1 unticked: Upcoming again, no watch');
select mt_plan('ran', 'Watch: Ran', 'b1000000-0000-0000-0000-000000000007');
select mt_set(mt_id('ran'), 'done');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000007')).status = 'completed', 'S2 a film on Watching: ticked, Completed (the Media page''s Completed)');
select mt_set(mt_id('ran'), 'open');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000007')).status = 'watching'
        and (mt_movie('b1000000-0000-0000-0000-000000000007')).rewatch_round is null,
  'S2 unticked: Watching again — not read as a new rewatch round (161)');
-- A rewatch: Arrival seen in 2024.
select mt_clear();
select mt_plan('arrival', 'Watch: Arrival', 'b1000000-0000-0000-0000-000000000002');
select mt_set(mt_id('arrival'), 'done');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000002')) = 2
        and (mt_movie('b1000000-0000-0000-0000-000000000002')).repeat_count = 1
        and (mt_movie('b1000000-0000-0000-0000-000000000002')).status = 'completed',
  'S3 a film seen before: the tick adds one more watch (×2), the 2024 one keeps its date');
select mt_set(mt_id('arrival'), 'open');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000002')) = 1
        and (select trakt_history_id from mt_watches('b1000000-0000-0000-0000-000000000002')) = 5001
        and (select count(*) from mt_outbox('history_remove_play', 9102)) = 1
        and not exists (select 1 from mt_outbox('history_remove', 9102)),
  'S3 unticked: only the tick''s watch goes (one play off Trakt); the 2024 watch and its Trakt play stay');
update public.user_movie_entries set status = 'watching' where id = 'b1000000-0000-0000-0000-000000000002';
insert into public.mt_keep values ('round', (select to_jsonb(m) from mt_movie('b1000000-0000-0000-0000-000000000002') m));
select mt_ok((select (v ->> 'rewatch_round')::int from public.mt_keep where k = 'round') = 2, 'S4 setup: Watching a finished film starts rewatch round 2 (161)');
select mt_set(mt_id('arrival'), 'done');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000002')).status = 'completed'
        and (mt_movie('b1000000-0000-0000-0000-000000000002')).rewatch_round is null,
  'S4 the tick finishes the rewatch: Completed, the round over (149''s rule, any writer)');
select mt_set(mt_id('arrival'), 'open');
select mt_ok((mt_movie('b1000000-0000-0000-0000-000000000002')).status = 'watching'
        and (mt_movie('b1000000-0000-0000-0000-000000000002')).rewatch_round = 2
        and (mt_movie('b1000000-0000-0000-0000-000000000002')).rewatch_started_at = (select (v ->> 'rewatch_started_at')::timestamptz from public.mt_keep where k = 'round'),
  'S4 unticked: rewatching again, round 2 from the same start');

-- ═══ G. The Google Tasks pull ticks it (the phone's Google Tasks app) ════════
select mt_plan('solaris', 'Watch: Solaris', 'b1000000-0000-0000-0000-000000000008');
reset role;
update public.tasks set google_task_id = 'g-mt-solaris', google_sync_enabled = true where id = mt_id('solaris');
delete from public.google_tasks_outbox where task_id = mt_id('solaris');
select mt_clear();
set test.uid = 'none';
set role service_role;
select public.upsert_task_from_google('g-mt-solaris', 'Watch: Solaris', null, null, 'completed', now(), p_user_id => '00000000-0000-0000-0000-000000000001');
select mt_ok((mt_task(mt_id('solaris'))).status = 'done'
        and (select count(*) from mt_watches('b1000000-0000-0000-0000-000000000008')) = 1
        and (select user_id from mt_watches('b1000000-0000-0000-0000-000000000008')) = '00000000-0000-0000-0000-000000000001'
        and (select count(*) from mt_outbox('history_add', 9108)) = 1,
  'G1 ticked in Google Tasks (the pull, as the service role): the owner''s watch, queued for Trakt');
select public.upsert_task_from_google('g-mt-solaris', 'Watch: Solaris', null, null, 'completed', now() + interval '1 minute', p_user_id => '00000000-0000-0000-0000-000000000001');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000008')) = 1,
  'G2 the next pull says completed again (Google''s echo): nothing more');
select public.upsert_task_from_google('g-mt-solaris', 'Watch: Solaris', null, null, 'needsAction', now() + interval '2 minutes', p_user_id => '00000000-0000-0000-0000-000000000001');
select mt_ok((mt_task(mt_id('solaris'))).status = 'open'
        and not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000008'))
        and (mt_movie('b1000000-0000-0000-0000-000000000008')).status = 'wishlist',
  'G3 unticked in Google Tasks: the watch goes, Wishlist again');
reset role;
reset test.uid;

-- ═══ A. Activity's Undo ══════════════════════════════════════════════════════
set role authenticated;
select mt_set(mt_id('solaris'), 'done');
do $$
begin
  update public.tasks set status = 'open' where id = public.mt_id('solaris');
  insert into public.mt_keep values ('untick_tx', to_jsonb(txid_current()));
end $$;
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000008')), 'A1 setup: ticked and unticked');
do $$
declare p jsonb; tx bigint := (select (v #>> '{}')::bigint from public.mt_keep where k = 'untick_tx');
begin
  p := public.app_undo_transaction(tx);
  p := public.app_undo_transaction(tx, true, p ->> 'confirm');
  perform public.mt_ok(p ->> 'error' is null, 'A1 Undo of the untick goes through');
end $$;
select mt_ok((mt_task(mt_id('solaris'))).status = 'done'
        and (select count(*) from mt_watches('b1000000-0000-0000-0000-000000000008')) = 1
        and (mt_movie('b1000000-0000-0000-0000-000000000008')).status = 'completed',
  'A1 Undo of the untick: done again with its one watch put back (the tick''s same-day rule writes no second one)');
select mt_set(mt_id('solaris'), 'open');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000008')) = 1,
  'A1 known limit (as 211''s other effects): Undo doesn''t put the ledger back, so a later untick keeps that watch');
reset role;
delete from public.media_watches where movie_entry_id = 'b1000000-0000-0000-0000-000000000008';
update public.user_movie_entries set status = 'wishlist' where id = 'b1000000-0000-0000-0000-000000000008';
select mt_clear();
set role authenticated;
do $$
begin
  update public.tasks set status = 'done' where id = public.mt_id('solaris');
  insert into public.mt_keep values ('tick_tx', to_jsonb(txid_current()));
end $$;
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000008')) = 1, 'A2 setup: ticked');
do $$
declare p jsonb; tx bigint := (select (v #>> '{}')::bigint from public.mt_keep where k = 'tick_tx');
begin
  p := public.app_undo_transaction(tx);
  p := public.app_undo_transaction(tx, true, p ->> 'confirm');
  perform public.mt_ok(p ->> 'error' is null, 'A2 Undo of the tick goes through');
end $$;
select mt_ok((mt_task(mt_id('solaris'))).status = 'open'
        and not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000008'))
        and (mt_movie('b1000000-0000-0000-0000-000000000008')).status = 'wishlist'
        and (mt_effect(mt_id('solaris'))).task_id is null,
  'A2 Undo of the tick: open again, the watch gone, Wishlist again, the ledger empty');
-- Activity's Undo puts the film's status back (Completed → Wishlist) as any writer would, so 149's movie trigger also
-- queues the whole film's remove — as undoing the Media page's first watch of a Wishlist film does today (it had no
-- play before the tick). Trakt ends with no play of it either way.
select mt_ok((select count(*) from mt_outbox('history_add', 9108)) = 1 and (select count(*) from mt_outbox('history_remove_play', 9108)) = 1
        and (select count(*) from mt_outbox('history_remove', 9108)) = 1,
  'A2 Trakt: the play''s add, its remove, and (from the status put back) the film''s remove — it had no play before the tick');
select mt_set(mt_id('solaris'), 'done');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000008')) = 1,
  'A3 ticked again after the Undo: one watch (the effect applies again, exactly once)');

-- ═══ X. Another account, and who may write what ═════════════════════════════
select mt_ok(mt_refused($$select public.app_save_item('{"title":"x","domain":"personal","priority":"medium","google":"none","today":"2026-11-25"}', '{"kind":"movie","id":"b1000000-0000-0000-0000-000000000009"}')$$) like 'IT011%',
  'X1 the owner can''t plan another account''s movie (210''s check)');
set test.uid = '00000000-0000-0000-0000-000000000002';
select mt_ok(mt_refused($$select public.app_save_item('{"title":"x","domain":"personal","priority":"medium","google":"none","today":"2026-11-25"}', '{"kind":"movie","id":"b1000000-0000-0000-0000-000000000001"}')$$) like 'IT011%',
  'X1 user 2 can''t plan the owner''s movie');
select mt_plan('u2', 'Watch: Stalker', 'b1000000-0000-0000-0000-000000000009');
select mt_ok(mt_refused(format('update public.tasks set movie_entry_id = %L where id = %L', 'b1000000-0000-0000-0000-000000000004', mt_id('u2'))) like 'IT011%',
  'X2 user 2 can''t point its own plan at the owner''s movie afterwards (210''s trigger, every writer)');
select mt_set(mt_id('u2'), 'done');
select mt_ok((select count(*) from public.media_watches where movie_entry_id = 'b1000000-0000-0000-0000-000000000009') = 1
        and (select count(*) from public.task_link_effects where task_id = mt_id('u2') and effect = 'movie_watched') = 1
        and (select count(*) from public.task_link_effects where user_id <> '00000000-0000-0000-0000-000000000002') = 0,
  'X3 user 2''s tick writes user 2''s own watch; user 2 sees only its own ledger row');
select mt_ok(not exists (select 1 from mt_outbox('history_add', 9109)), 'X3 user 2 has no Trakt connected: nothing queued');
select mt_ok(mt_refused(format($$insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after) values (%L, 'movie_watched', %L, %L, '{}', '{}')$$,
          mt_id('u2'), '00000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000009')) like '42501%'
        and mt_refused(format($$update public.task_link_effects set after = jsonb_set(after, '{watch_id}', '"%s"') where task_id = %L$$,
          gen_random_uuid(), mt_id('u2'))) like '42501%',
  'X4 the browser can''t write the ledger (insert or change which watch an untick removes)');
reset test.uid;
-- A forged Trakt play id on the tick's watch: dropped by 149 (the delete target is the sync's alone).
select mt_set(mt_id('paprika'), 'done');
update public.media_watches set trakt_history_id = 424242 where movie_entry_id = 'b1000000-0000-0000-0000-000000000010';
select mt_ok((select trakt_history_id from mt_watches('b1000000-0000-0000-0000-000000000010')) is null,
  'X5 the browser can''t set a watch''s Trakt play id');
select mt_clear();
select mt_set(mt_id('paprika'), 'open');
select mt_ok((select count(*) from mt_outbox('history_remove_play', 9110)) = 1
        and (select payload ->> 'history_id' from mt_outbox('history_remove_play', 9110)) is null,
  'X5 its untick''s Trakt remove carries no forged id (the drain finds the play by the exact second, never a guess)');
reset role;
select mt_ok(not has_function_privilege('authenticated', 'public.tasks_link_effects()', 'execute')
        and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.tasks_link_effects()'::regprocedure),
  'X6 the effect function: SECURITY DEFINER with search_path '''', not callable by the browser');

-- ═══ EP. One episode of a show (owner, 28.11.2026: "Tv episodes too!!") ═════
-- A plan of one episode, as the Plan button saves it: the link (210) and its slot naming the episode (155's blockSource).
create or replace function public.mt_ep_plan(p_k text, p_entry uuid, p_season int, p_episode int, p_date date default date '2026-11-28') returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.app_save_item(jsonb_build_object('title', format('Watch S%sE%s', p_season, p_episode), 'domain', 'personal', 'priority', 'medium',
         'date', p_date::text, 'time', '21:00', 'durationMinutes', 50, 'google', 'none', 'today', '2026-11-25',
         'blockSource', jsonb_build_object('type', 'tv_episode', 'id', p_entry::text, 'seasonNumber', p_season, 'episodeNumber', p_episode)),
       jsonb_build_object('kind', 'tv', 'id', p_entry::text, 'season', p_season, 'episode', p_episode));
  insert into public.mt_keep values (p_k, r) on conflict (k) do update set v = excluded.v;
  return (r ->> 'taskId')::uuid;
end $$;
grant execute on function public.mt_ep_plan(text, uuid, int, int, date) to authenticated;
create or replace function public.mt_ep_watches(p_series uuid, p_s int, p_e int) returns setof public.media_watches language sql security definer set search_path = '' as $$
  select * from public.media_watches where kind = 'episode' and tv_series_id = p_series and season_number = p_s and episode_number = p_e
   order by watched_at, created_at
$$;
grant execute on function public.mt_ep_watches(uuid, int, int) to authenticated;
create or replace function public.mt_ep_effect(p_task uuid) returns public.task_link_effects language sql security definer set search_path = '' as $$
  select * from public.task_link_effects where task_id = p_task and effect = 'episode_watched'
$$;
grant execute on function public.mt_ep_effect(uuid) to authenticated;
create or replace function public.mt_slots(p_task uuid) returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.time_blocks where task_id = p_task
$$;
grant execute on function public.mt_slots(uuid) to authenticated;
create or replace function public.mt_show(p uuid) returns public.user_tv_entries language sql security definer set search_path = '' as $$
  select * from public.user_tv_entries where id = p
$$;
grant execute on function public.mt_show(uuid) to authenticated;

insert into public.tv_series (id, tmdb_id, title) values
  ('c0000000-0000-0000-0000-000000000001', 4242, 'Severance'),
  ('c0000000-0000-0000-0000-000000000009', 4249, 'Show of user 2');
insert into public.user_tv_entries (id, user_id, title, tv_series_id, status) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Severance', 'c0000000-0000-0000-0000-000000000001', 'watching'),
  ('c1000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', 'Show of user 2', 'c0000000-0000-0000-0000-000000000009', 'watching');
select mt_clear();
set role authenticated;
select mt_ep_plan('s1e3', 'c1000000-0000-0000-0000-000000000001', 1, 3, (now() at time zone 'Europe/Oslo')::date);
-- A stray reminder slot of the same episode with no task (an old planner's): 155's rule still clears it.
insert into public.time_blocks (user_id, date, title, source_type, source_id, season_number, episode_number) values
  ('00000000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Oslo')::date, 'Severance S1E3 (old reminder)', 'tv_episode',
   'c1000000-0000-0000-0000-000000000001', 1, 3);
select mt_ok(mt_slots(mt_id('s1e3')) = 1 and (mt_task(mt_id('s1e3'))).link_episode = 3, 'EP setup: the episode plan has its slot and its link');
select mt_set(mt_id('s1e3'), 'done');
select mt_ok((select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3)) = 1
        and (select watched_at = date_trunc('second', (mt_task(mt_id('s1e3'))).completed_at) and source = 'app'
               from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3))
        and (select watched_at from public.user_tv_episodes where tv_entry_id = 'c1000000-0000-0000-0000-000000000001' and season_number = 1 and episode_number = 3)
            = (select watched_at from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3)),
  'EP1 an episode plan ticked: one watch of that episode dated at the tick; the episode is watched (149 made its row)');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000001')).current_season = 1 and (mt_show('c1000000-0000-0000-0000-000000000001')).current_episode = 3
        and (mt_show('c1000000-0000-0000-0000-000000000001')).status = 'watching',
  'EP1 the show''s next-episode pointer follows (050), its status stays (the checkbox doesn''t touch it either)');
reset role;
select mt_ok((select count(*) from public.trakt_outbox where op = 'history_add' and item_key = 'ep:4242:1:3'
               and payload ->> 'type' = 'episode' and (payload ->> 'season')::int = 1 and (payload ->> 'episode')::int = 3
               and payload ->> 'watch_id' = (select id::text from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3))) = 1,
  'EP1 Trakt gets that one episode play (history_add in the shows / seasons / episodes shape, the existing outbox)');
select mt_ok(mt_slots(mt_id('s1e3')) = 1
        and not exists (select 1 from public.time_blocks where task_id is null and source_type = 'tv_episode' and source_id = 'c1000000-0000-0000-0000-000000000001'),
  'EP1 043/155''s rule keeps the ticked plan''s own slot (its record) and still clears the other slot of that episode');
select mt_ok((mt_ep_effect(mt_id('s1e3'))).after ->> 'season' = '1' and (mt_ep_effect(mt_id('s1e3'))).after ->> 'episode' = '3'
        and (mt_ep_effect(mt_id('s1e3'))).target_id = 'c1000000-0000-0000-0000-000000000001',
  'EP1 the ledger names the watch, the show and the episode');
set role authenticated;
select mt_set(mt_id('s1e3'), 'done');
update public.tasks set completed_at = completed_at + interval '1 minute' where id = mt_id('s1e3');
select mt_ok((select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3)) = 1,
  'EP2 a second tick or a later write of the done task adds nothing');
reset role;
select mt_clear();
set role authenticated;
select mt_set(mt_id('s1e3'), 'open');
select mt_ok(not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3))
        and (select watched_at from public.user_tv_episodes where tv_entry_id = 'c1000000-0000-0000-0000-000000000001' and season_number = 1 and episode_number = 3) is null
        and (mt_show('c1000000-0000-0000-0000-000000000001')).current_episode = 0
        and mt_slots(mt_id('s1e3')) = 1 and (mt_ep_effect(mt_id('s1e3'))).task_id is null,
  'EP3 unticked: the watch goes, the episode reads not watched, the pointer steps back, the slot is still there');
reset role;
select mt_ok((select count(*) from public.trakt_outbox where op = 'history_remove_play' and item_key = 'ep:4242:1:3') = 1
        and not exists (select 1 from public.trakt_outbox where op = 'history_remove'),
  'EP3 Trakt loses that one play — never the whole episode''s remove');
set role authenticated;
-- Re-dated by the owner: kept.
select mt_set(mt_id('s1e3'), 'done');
update public.media_watches set watched_at = '2026-11-21 22:00+01'
 where kind = 'episode' and tv_series_id = 'c0000000-0000-0000-0000-000000000001' and season_number = 1 and episode_number = 3;
select mt_set(mt_id('s1e3'), 'open');
select mt_ok((select watched_at from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 3)) = '2026-11-21 22:00+01',
  'EP4 the owner re-dated the tick''s episode watch: the untick leaves it');
-- Cancelled after done.
select mt_ep_plan('s1e6', 'c1000000-0000-0000-0000-000000000001', 1, 6);
select mt_set(mt_id('s1e6'), 'done');
select mt_set(mt_id('s1e6'), 'cancelled');
select mt_ok(not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 6)) and mt_slots(mt_id('s1e6')) = 1,
  'EP5 done, then cancelled: the watch goes, the slot stays (the cancelled plan''s record)');
-- A Trakt watch of that episode today, from before the plan: the tick writes no second one.
reset role;
begin;
set local app.trakt_sync = 'on';
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at, trakt_history_id, source) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000001', 1, 5,
   greatest(now() - interval '1 hour', ((now() at time zone 'Europe/Oslo')::date + time '00:00:01') at time zone 'Europe/Oslo'), 8001, 'trakt');
commit;
set role authenticated;
select mt_ep_plan('s1e5', 'c1000000-0000-0000-0000-000000000001', 1, 5, (now() at time zone 'Europe/Oslo')::date);
select mt_set(mt_id('s1e5'), 'done');
select mt_ok((select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 5)) = 1
        and (mt_ep_effect(mt_id('s1e5'))).task_id is null,
  'EP6 the episode already has a watch on the tick''s day (marked on Trakt, synced): no second watch, nothing to undo');
-- A watch from the Media page closes the plan (155's rule — that watch is the record; its slot goes as 155 says).
select mt_ep_plan('s1e4', 'c1000000-0000-0000-0000-000000000001', 1, 4, (now() at time zone 'Europe/Oslo')::date);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000001', 1, 4, now() + interval '2 seconds');
select mt_ok((mt_task(mt_id('s1e4'))).status = 'done'
        and (select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 4)) = 1
        and (mt_ep_effect(mt_id('s1e4'))).task_id is null,
  'EP7 the Media page''s watch closes its plan (155): still one watch — the plan closed by a record writes none');
-- A plan of the whole show (no episode): only closes.
insert into public.mt_keep values ('show', public.app_save_item(jsonb_build_object('title', 'Severance night', 'domain', 'personal', 'priority', 'medium',
  'date', '2026-11-28', 'time', '21:00', 'durationMinutes', 50, 'google', 'none', 'today', '2026-11-25'),
  '{"kind":"tv","id":"c1000000-0000-0000-0000-000000000001"}'));
reset role;
create table public.mt_n2 as select count(*) as n from public.media_watches;
set role authenticated;
select mt_set(mt_id('show'), 'done');
reset role;
select mt_ok((select count(*) from public.media_watches) = (select n from public.mt_n2)
        and not exists (select 1 from public.task_link_effects where task_id = mt_id('show')),
  'EP8 a plan of a whole show with no stored TMDB data ticked: no next episode is known, so it only closes — never a guess');
-- Activity's Undo of an episode tick.
set role authenticated;
select mt_ep_plan('s1e7', 'c1000000-0000-0000-0000-000000000001', 1, 7);
do $$
begin
  update public.tasks set status = 'done' where id = public.mt_id('s1e7');
  insert into public.mt_keep values ('ep_tick_tx', to_jsonb(txid_current()));
end $$;
do $$
declare p jsonb; tx bigint := (select (v #>> '{}')::bigint from public.mt_keep where k = 'ep_tick_tx');
begin
  p := public.app_undo_transaction(tx);
  p := public.app_undo_transaction(tx, true, p ->> 'confirm');
  perform public.mt_ok(p ->> 'error' is null, 'EP9 Undo of an episode tick goes through');
end $$;
select mt_ok((mt_task(mt_id('s1e7'))).status = 'open'
        and not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000001', 1, 7))
        and mt_slots(mt_id('s1e7')) = 1,
  'EP9 Undo of the tick: open again, no watch, its slot in place');
reset role;
select mt_ok((select array_agg(op order by seq) from public.trakt_outbox where item_key = 'ep:4242:1:7') = array['history_add', 'history_remove_play'],
  'EP9 Trakt: the play''s add and its remove (the drain cancels the pair) — no whole-episode remove');
set role authenticated;
-- Another account.
select mt_ok(mt_refused($$select public.app_save_item('{"title":"x","domain":"personal","priority":"medium","google":"none","today":"2026-11-25"}', '{"kind":"tv","id":"c1000000-0000-0000-0000-000000000009","season":1,"episode":1}')$$) like 'IT011%',
  'EP10 the owner can''t plan an episode of another account''s show');
set test.uid = '00000000-0000-0000-0000-000000000002';
select mt_ep_plan('u2ep', 'c1000000-0000-0000-0000-000000000009', 1, 1);
select mt_set(mt_id('u2ep'), 'done');
select mt_ok((select count(*) from public.media_watches where kind = 'episode' and tv_series_id = 'c0000000-0000-0000-0000-000000000009') = 1
        and (select count(*) from public.media_watches where kind = 'episode' and tv_series_id = 'c0000000-0000-0000-0000-000000000001') = 0,
  'EP10 user 2''s episode tick writes only user 2''s watch (and sees none of the owner''s)');
reset test.uid;
reset role;
select mt_ok(not has_function_privilege('authenticated', 'public.plan_tick_task()', 'execute')
        and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.media_watch_cleans_planned_block()'::regprocedure)
        and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.cleanup_block_on_episode_watched()'::regprocedure),
  'EP11 the slot rule''s functions run with search_path ''''; the tick''s marker is not the browser''s to call');
begin;
select set_config('app.plan_tick', (select mt_id('s1e3'))::text || ':1', true);
select mt_ok(public.plan_tick_task() is null, 'EP11 a marker stamped with another transaction''s id is ignored');
commit;

-- ═══ SP. The show moves on as the Trakt sync would set it (and back on untick) ═══
insert into public.tv_series (id, tmdb_id, title, metadata_json) values
  ('c0000000-0000-0000-0000-000000000002', 4250, 'Dark', '{}'),
  ('c0000000-0000-0000-0000-000000000003', 4251, 'Chernobyl',
   '{"status": "Ended", "seasons": [{"season_number": 1, "episode_count": 2}], "last_episode_to_air": {"season_number": 1, "episode_number": 2}}'),
  ('c0000000-0000-0000-0000-000000000004', 4252, 'Lost', '{}'),
  ('c0000000-0000-0000-0000-000000000005', 4253, 'Fargo', '{}');
insert into public.user_tv_entries (id, user_id, title, tv_series_id, status, started_at) values
  ('c1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Dark', 'c0000000-0000-0000-0000-000000000002', 'wishlist', null),
  ('c1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Chernobyl', 'c0000000-0000-0000-0000-000000000003', 'watching', '2026-11-01 20:00+01'),
  ('c1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Lost', 'c0000000-0000-0000-0000-000000000004', 'paused', '2025-01-01 20:00+01'),
  ('c1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Fargo', 'c0000000-0000-0000-0000-000000000005', 'dropped', null);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000003', 1, 1, '2026-11-01 21:00+01');
set role authenticated;
select mt_ep_plan('dark', 'c1000000-0000-0000-0000-000000000002', 1, 1);
select mt_set(mt_id('dark'), 'done');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000002')).status = 'watching'
        and (mt_show('c1000000-0000-0000-0000-000000000002')).started_at = (select watched_at from mt_ep_watches('c0000000-0000-0000-0000-000000000002', 1, 1))
        and (mt_show('c1000000-0000-0000-0000-000000000002')).finished_at is null,
  'SP1 a Wishlist show''s episode ticked: Watching, started at the tick (the sync''s rule: aired unknown → Watching)');
select mt_set(mt_id('dark'), 'open');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000002')).status = 'wishlist' and (mt_show('c1000000-0000-0000-0000-000000000002')).started_at is null,
  'SP1 unticked: back on Wishlist, no start date');
select mt_ep_plan('lost', 'c1000000-0000-0000-0000-000000000004', 1, 1);
select mt_set(mt_id('lost'), 'done');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000004')).status = 'watching'
        and (mt_show('c1000000-0000-0000-0000-000000000004')).started_at = '2025-01-01 20:00+01',
  'SP2 a Paused show''s episode ticked: Watching again, its own start date kept');
select mt_set(mt_id('lost'), 'cancelled');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000004')).status = 'paused', 'SP2 cancelled: Paused again');
select mt_ep_plan('chern', 'c1000000-0000-0000-0000-000000000003', 1, 2);
select mt_set(mt_id('chern'), 'done');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000003')).status = 'completed'
        and (mt_show('c1000000-0000-0000-0000-000000000003')).finished_at = (select watched_at from mt_ep_watches('c0000000-0000-0000-0000-000000000003', 1, 2))
        and (mt_show('c1000000-0000-0000-0000-000000000003')).started_at = '2026-11-01 20:00+01',
  'SP3 the last aired episode (TMDB''s data) ticked: Completed, finished at the tick — as the Trakt sync would set it');
select mt_set(mt_id('chern'), 'open');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000003')).status = 'watching'
        and (mt_show('c1000000-0000-0000-0000-000000000003')).finished_at is null
        and (mt_show('c1000000-0000-0000-0000-000000000003')).rewatch_round is null,
  'SP3 unticked: Watching again, no finish date — and not read as a new rewatch (161)');
select mt_set(mt_id('chern'), 'done');
update public.user_tv_entries set status = 'paused' where id = 'c1000000-0000-0000-0000-000000000003';
select mt_set(mt_id('chern'), 'open');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000003')).status = 'paused'
        and not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000003', 1, 2)),
  'SP4 the owner set Paused after the tick: the untick removes its watch and keeps the owner''s status');
select mt_ep_plan('fargo', 'c1000000-0000-0000-0000-000000000005', 1, 1);
select mt_set(mt_id('fargo'), 'done');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000005')).status = 'dropped'
        and (select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000005', 1, 1)) = 1,
  'SP5 a Dropped show: the episode is watched, the show stays Dropped (as the sync keeps it)');

-- ═══ D. The tick's date: Undo puts the watch back at it; never before 1971, never ahead ═══
select mt_set(mt_id('dune'), 'done');
insert into public.mt_keep values ('dune_at', to_jsonb((mt_effect(mt_id('dune'))).after ->> 'watched_at'));
select mt_set(mt_id('dune'), 'open');
-- The reopen toast's Undo: ticked again with the tick's own time.
update public.tasks set status = 'done', completed_at = (select (v #>> '{}')::timestamptz from public.mt_keep where k = 'dune_at') where id = mt_id('dune');
select mt_ok((select count(*) from mt_watches('b1000000-0000-0000-0000-000000000001')) = 1
        and (select watched_at from mt_watches('b1000000-0000-0000-0000-000000000001')) = (select (v #>> '{}')::timestamptz from public.mt_keep where k = 'dune_at'),
  'DT1 Undo of the untick ticks again at the tick''s own time: the watch is back at its date');
select mt_set(mt_id('dune'), 'open');
update public.tasks set status = 'done', completed_at = now() + interval '3 days' where id = mt_id('dune');
select mt_ok((select watched_at from mt_watches('b1000000-0000-0000-0000-000000000001')) <= now(),
  'DT2 a close time ahead of now dates the watch now (never a future watch)');
select mt_set(mt_id('dune'), 'open');
update public.tasks set status = 'done', completed_at = '1960-06-01 12:00+00' where id = mt_id('dune');
select mt_ok(not exists (select 1 from mt_watches('b1000000-0000-0000-0000-000000000001'))
        and (mt_effect(mt_id('dune'))).task_id is null,
  'DT3 a close time before 1971 writes no watch (Trakt''s unknown date is the epoch) and nothing to undo');
select mt_set(mt_id('lost'), 'open');
update public.tasks set status = 'done', completed_at = '1969-07-20 20:17+00' where id = mt_id('lost');
select mt_ok(not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000004', 1, 1)),
  'DT3 the same floor for an episode');
reset role;

-- ═══ RW. A re-watched episode's untick; the session's time zone ══════════════
insert into public.tv_series (id, tmdb_id, title, metadata_json) values
  ('c0000000-0000-0000-0000-000000000006', 4254, 'Mare of Easttown',
   '{"status": "Ended", "seasons": [{"season_number": 1, "episode_count": 2}], "last_episode_to_air": {"season_number": 1, "episode_number": 2}}'),
  ('c0000000-0000-0000-0000-000000000007', 4255, 'Ripley', '{}');
insert into public.user_tv_entries (id, user_id, title, tv_series_id, status, started_at) values
  ('c1000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Mare of Easttown', 'c0000000-0000-0000-0000-000000000006', 'watching', '2026-10-01 20:00+02'),
  ('c1000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Ripley', 'c0000000-0000-0000-0000-000000000007', 'wishlist', null);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000006', 1, 1, '2026-10-01 21:00+02'),
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000006', 1, 2, '2026-10-02 21:00+02');
update public.user_tv_entries set status = 'watching', rewatch_round = null where id = 'c1000000-0000-0000-0000-000000000006';
set role authenticated;
select mt_ep_plan('mare', 'c1000000-0000-0000-0000-000000000006', 1, 2);
select mt_set(mt_id('mare'), 'done');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000006')).status = 'completed'
        and (select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000006', 1, 2)) = 2,
  'RW1 an ended show with every aired episode watched: a rewatch of S1E2 ticked — a second watch, Completed');
select mt_set(mt_id('mare'), 'open');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000006')).status = 'watching'
        and (mt_show('c1000000-0000-0000-0000-000000000006')).rewatch_round is null
        and (select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000006', 1, 2)) = 1,
  'RW1 a re-watched episode''s untick invents no rewatch round: Watching again, round none, the first watch kept');
-- Ticked under UTC, unticked under Oslo time: the dates compare as times, not as text.
select mt_ep_plan('ripley', 'c1000000-0000-0000-0000-000000000007', 1, 1);
set timezone = 'UTC';
select mt_set(mt_id('ripley'), 'done');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000007')).status = 'watching'
        and (mt_show('c1000000-0000-0000-0000-000000000007')).started_at is not null,
  'TZ1 ticked in a UTC session: Watching, started');
set timezone = 'Europe/Oslo';
select mt_set(mt_id('ripley'), 'open');
select mt_ok((mt_show('c1000000-0000-0000-0000-000000000007')).status = 'wishlist'
        and (mt_show('c1000000-0000-0000-0000-000000000007')).started_at is null,
  'TZ1 unticked in an Oslo session: back on Wishlist, no start date (the time zone doesn''t change what "as the tick left it" means)');
reset timezone;
reset role;

-- ═══ WS. A plan of the whole show marks its NEXT episode (owner, 28.11.2026: "Yes") ═══
insert into public.tv_series (id, tmdb_id, title, metadata_json) values
  ('c0000000-0000-0000-0000-000000000008', 4256, 'Shogun',
   '{"status": "Returning Series", "seasons": [{"season_number": 0, "episode_count": 4}, {"season_number": 1, "episode_count": 2}, {"season_number": 2, "episode_count": 3}],
     "last_episode_to_air": {"season_number": 2, "episode_number": 3}}'),
  ('c0000000-0000-0000-0000-000000000010', 4257, 'Slow Horses',
   '{"seasons": [{"season_number": 1, "episode_count": 3}], "last_episode_to_air": {"season_number": 1, "episode_number": 3}}'),
  ('c0000000-0000-0000-0000-000000000011', 4258, 'Show of user 2 with data',
   '{"seasons": [{"season_number": 1, "episode_count": 2}], "last_episode_to_air": {"season_number": 1, "episode_number": 2}}');
insert into public.user_tv_entries (id, user_id, title, tv_series_id, status, started_at) values
  ('c1000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Shogun', 'c0000000-0000-0000-0000-000000000008', 'watching', '2026-10-01 20:00+02'),
  ('c1000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Slow Horses', 'c0000000-0000-0000-0000-000000000010', 'watching', '2026-10-01 20:00+02'),
  ('c1000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', 'Show of user 2 with data', 'c0000000-0000-0000-0000-000000000011', 'watching', null);
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000008', 1, 1, '2026-10-01 21:00+02');
create or replace function public.mt_show_plan(p_k text, p_entry uuid) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.app_save_item(jsonb_build_object('title', 'Watch the show', 'domain', 'personal', 'priority', 'medium',
         'date', '2026-11-28', 'time', '21:00', 'durationMinutes', 50, 'google', 'none', 'today', '2026-11-25'),
       jsonb_build_object('kind', 'tv', 'id', p_entry::text));
  insert into public.mt_keep values (p_k, r) on conflict (k) do update set v = excluded.v;
  return (r ->> 'taskId')::uuid;
end $$;
grant execute on function public.mt_show_plan(text, uuid) to authenticated;
select mt_clear();
set role authenticated;
select mt_show_plan('shogun', 'c1000000-0000-0000-0000-000000000008');
select mt_ok((mt_task(mt_id('shogun'))).link_season is null and (mt_task(mt_id('shogun'))).tv_entry_id = 'c1000000-0000-0000-0000-000000000008',
  'WS setup: a plan of the whole show (its link names no episode)');
select mt_set(mt_id('shogun'), 'done');
select mt_ok((select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000008', 1, 2)) = 1
        and (mt_ep_effect(mt_id('shogun'))).after ->> 'season' = '1' and (mt_ep_effect(mt_id('shogun'))).after ->> 'episode' = '2'
        and (mt_ep_effect(mt_id('shogun'))).after ->> 'next' = 'true'
        and (mt_show('c1000000-0000-0000-0000-000000000008')).current_episode = 2,
  'WS1 a whole-show plan ticked: the next episode after the last watched (S01E02, not a special) is watched and recorded');
reset role;
select mt_ok((select count(*) from public.trakt_outbox where op = 'history_add' and item_key = 'ep:4256:1:2') = 1,
  'WS1 Trakt gets that episode''s play');
set role authenticated;
select mt_set(mt_id('shogun'), 'open');
select mt_ok(not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000008', 1, 2))
        and (mt_show('c1000000-0000-0000-0000-000000000008')).current_episode = 1,
  'WS2 unticked: that one watch goes, the pointer steps back');
-- The season rolls over: S1E2 watched on the Media page another day, the next is S2E1.
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000008', 1, 2, '2026-10-02 21:00+02');
select mt_set(mt_id('shogun'), 'done');
select mt_ok((select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000008', 2, 1)) = 1
        and (mt_ep_effect(mt_id('shogun'))).after ->> 'season' = '2' and (mt_ep_effect(mt_id('shogun'))).after ->> 'episode' = '1',
  'WS3 the last episode of a season watched: the tick marks the next season''s first (S02E01)');
-- Another episode watched in between (another day): the untick still removes only the recorded one.
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000008', 2, 2, '2026-10-03 21:00+02');
select mt_set(mt_id('shogun'), 'open');
select mt_ok(not exists (select 1 from mt_ep_watches('c0000000-0000-0000-0000-000000000008', 2, 1))
        and (select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000008', 2, 2)) = 1
        and (select count(*) from mt_ep_watches('c0000000-0000-0000-0000-000000000008', 1, 2)) = 1,
  'WS4 an episode watched in between: the untick removes the recorded S02E01 only — "next" is never worked out again');
-- Every aired episode watched: nothing to mark.
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000008', 2, 1, '2026-10-03 22:00+02'),
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000008', 2, 3, '2026-10-04 21:00+02');
reset role;
create table public.mt_n3 as select count(*) as n from public.media_watches;
set role authenticated;
select mt_set(mt_id('shogun'), 'done');
reset role;
select mt_ok((select count(*) from public.media_watches) = (select n from public.mt_n3)
        and not exists (select 1 from public.task_link_effects where task_id = mt_id('shogun')),
  'WS5 every aired episode watched (the next one hasn''t aired): no next episode — nothing written, the plan just closes');
-- An episode of the show already watched today (the Media page): that is the evening's record.
set role authenticated;
select mt_show_plan('slow', 'c1000000-0000-0000-0000-000000000010');
insert into public.media_watches (user_id, kind, tv_series_id, season_number, episode_number, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'episode', 'c0000000-0000-0000-0000-000000000010', 1, 1, now());
select mt_set(mt_id('slow'), 'done');
select mt_ok((select count(*) from public.media_watches where kind = 'episode' and tv_series_id = 'c0000000-0000-0000-0000-000000000010') = 1
        and (mt_ep_effect(mt_id('slow'))).task_id is null,
  'WS6 an episode of the show already watched today: the whole-show tick writes nothing (no second episode for one evening)');
-- Another account.
select mt_ok(mt_refused($$select public.app_save_item('{"title":"x","domain":"personal","priority":"medium","google":"none","today":"2026-11-25"}', '{"kind":"tv","id":"c1000000-0000-0000-0000-000000000011"}')$$) like 'IT011%',
  'WS7 the owner can''t plan another account''s show');
set test.uid = '00000000-0000-0000-0000-000000000002';
select mt_show_plan('u2show', 'c1000000-0000-0000-0000-000000000011');
select mt_set(mt_id('u2show'), 'done');
select mt_ok((select count(*) from public.media_watches where kind = 'episode' and tv_series_id = 'c0000000-0000-0000-0000-000000000011' and season_number = 1 and episode_number = 1) = 1
        and (select count(*) from public.media_watches where kind = 'episode' and tv_series_id = 'c0000000-0000-0000-0000-000000000008') = 0,
  'WS7 user 2''s whole-show tick marks user 2''s own next episode (S01E01) and sees none of the owner''s');
reset test.uid;
reset role;
select mt_ok(not has_function_privilege('authenticated', 'public.show_next_episode(uuid, uuid)', 'execute')
        and (select count(*) from public.show_next_episode('c1000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000002')) = 0,
  'WS8 the next-episode helper is not the browser''s, and answers only for the show''s own user');
