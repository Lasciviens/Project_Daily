-- Migration 211 (linked plans: what a done plan does, the syncs that close plans, one training identity, the
-- notifications table, football's Plan it in one save) on the item chain with 210 and the stand-ins of
-- linked-plans/seed.sql, after 211 ran twice (scripts/verify-db-linked-plans.mjs). Setup and checks run as the
-- superuser (a writer without row security, as the service role is); app writes as `authenticated` (test.uid picks the
-- caller: unset = the owner, user 2 = another allowed account). Ids are task-links/seed.sql's: 1000… movies, 3000…
-- shop items, 4000… wishes, 5000… a game, 6000… a book, aaaa… routines; 9xxx… are made here.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'written';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function public.t_refused(text) to authenticated;
create or replace function public.t_item(p_title text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'domain', 'personal', 'priority', 'medium', 'date', '2026-11-28',
    'time', '19:00', 'durationMinutes', 60, 'google', 'none', 'today', '2026-11-25') || extra
$$;
grant execute on function public.t_item(text, jsonb) to authenticated;
create or replace function public.t_task(p uuid) returns public.tasks language sql security definer set search_path = '' as $$
  select * from public.tasks where id = p
$$;
grant execute on function public.t_task(uuid) to authenticated;
create or replace function public.t_id(p_k text) returns uuid language sql as $$
  select (v ->> 'taskId')::uuid from public.t_keep where k = p_k
$$;
grant execute on function public.t_id(text) to authenticated;
create or replace function public.t_set(p_task uuid, p_status text) returns void language sql as $$
  update public.tasks set status = p_status where id = p_task
$$;
grant execute on function public.t_set(uuid, text) to authenticated;

-- ═══ R. The runs ═════════════════════════════════════════════════════════════
select t_ok((select count(*) from public.tasks) = (select count(*) from public.t_before211)
        and not exists (select 1 from public.t_before211 b where not exists (
              select 1 from public.tasks t where t.id = b.id and t.status = b.status and t.title = b.title)),
  'R1 NEVER_HIDES: every task is still there after 211 ran twice, its status and title as they were');
select t_ok((select hevy_workout_id from public.health_workouts where id = 'apple-old-1') = 'hevy-old-1'
        and (select hevy_workout_id from public.health_workouts where id = 'apple-old-2') is null,
  'R2 the rows already there: the Hevy-written workout is linked to its Hevy workout, the Watch walk is not');
select t_ok(not exists (select 1 from public.health_workouts where raw -> 'source' ? 'name' or raw::text like '%Nordmann%')
        and (select raw #>> '{source,identifier}' from public.health_workouts where id = 'apple-old-1') = 'com.hevyapp.hevy',
  'R3 the Watch''s device name is gone from the rows already there; the source''s identifier stays');

-- ═══ E. App-owned: ticking does it once, unticking undoes it ═════════════════
set role authenticated;
insert into public.t_keep values ('shop', public.app_save_item(public.t_item('Buy a kettle'), '{"kind":"shop_item","id":"30000000-0000-0000-0000-000000000005"}'));
select t_set(t_id('shop'), 'done');
select t_ok((select status from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = 'bought'
        and (select bought_at from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = (t_task(t_id('shop'))).completed_at,
  'E1 a done plan of a wishlist thing: bought, at the moment of the tick (the purchase draft)');
select t_ok((select count(*) from public.notifications where kind = 'shop_bought_draft' and link_kind = 'shop_item'
              and link_id = '30000000-0000-0000-0000-000000000005' and read_at is null) = 1,
  'E1 one notification: "a plan bought this thing — check the purchase" (Needs a look shows it)');
reset role;
select t_ok((select count(*) from public.task_link_effects where task_id = t_id('shop')) = 1,
  'E1 the ledger holds the effect once');
update public.tasks set status = 'done', completed_at = now() + interval '1 minute' where id = t_id('shop');
update public.tasks set title = 'Buy a kettle (echo)' where id = t_id('shop');
select t_ok((select count(*) from public.task_link_effects where task_id = t_id('shop')) = 1
        and (select count(*) from public.notifications where link_id = '30000000-0000-0000-0000-000000000005') = 1,
  'E2 a second write of done (an echo, a sync) adds nothing: one effect, one notification');
set role authenticated;
select t_set(t_id('shop'), 'open');
select t_ok((select status from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = 'wishlist'
        and (select bought_at from public.shop_items where id = '30000000-0000-0000-0000-000000000005') is null
        and not exists (select 1 from public.notifications where link_id = '30000000-0000-0000-0000-000000000005'),
  'E3 unticking undoes it: back on the wishlist, the draft and its notification gone');
reset role;
select t_ok(not exists (select 1 from public.task_link_effects where task_id = t_id('shop')),
  'E3 the ledger forgets the undone effect (a new tick applies it again, exactly once)');
set role authenticated;
select t_set(t_id('shop'), 'done');
select t_set(t_id('shop'), 'open');
select t_set(t_id('shop'), 'done');
select t_ok((select status from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = 'bought'
        and (select count(*) from public.notifications where link_id = '30000000-0000-0000-0000-000000000005') = 1,
  'E4 tick, untick, tick: bought once, one notification');
-- The owner fills the purchase in (a price): it is the owner's purchase now, never undone by an untick.
update public.shop_items set price = 499, currency = 'NOK' where id = '30000000-0000-0000-0000-000000000005';
select t_set(t_id('shop'), 'open');
select t_ok((select status from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = 'bought'
        and (select price from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = 499
        and not exists (select 1 from public.notifications where link_id = '30000000-0000-0000-0000-000000000005'),
  'E5 a draft the owner changed stays bought on untick (only an unchanged draft is removed); its notification goes');
-- A thing already yours (a return or complaint plan, a handover) and a quick-list errand: the plan just closes.
reset role;
update public.shop_items set status = 'bought', bought_at = '2026-11-01 10:00+00' where id = '30000000-0000-0000-0000-000000000001';
insert into public.shop_items (id, user_id, title, list) values ('30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Milk', 'quick');
insert into public.t_keep select 'owned', jsonb_build_object('taskId', id) from public.tasks where shop_item_id = '30000000-0000-0000-0000-000000000001';
set role authenticated;
insert into public.t_keep values ('quick', public.app_save_item(public.t_item('Buy milk'), '{"kind":"shop_item","id":"30000000-0000-0000-0000-000000000006"}'));
select t_set(t_id('owned'), 'done');
select t_set(t_id('quick'), 'done');
select t_ok((select status from public.shop_items where id = '30000000-0000-0000-0000-000000000001') = 'bought'
        and (select bought_at from public.shop_items where id = '30000000-0000-0000-0000-000000000001') = '2026-11-01 10:00+00'
        and (select status from public.shop_items where id = '30000000-0000-0000-0000-000000000006') = 'wishlist'
        and (t_task(t_id('owned'))).status = 'done' and (t_task(t_id('quick'))).status = 'done',
  'E6 a return / complaint / handover plan of a thing already yours, and a quick-list errand: the task closes, nothing else');
reset role;
select t_ok(not exists (select 1 from public.task_link_effects where task_id in (t_id('owned'), t_id('quick')))
        and not exists (select 1 from public.notifications where link_id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000006')),
  'E6 … no effect in the ledger and no notification');

-- A wish: fulfilled; unticked, back to planned — unless the owner changed it since.
set role authenticated;
insert into public.t_keep values ('wish', public.app_save_item(public.t_item('Go to the museum'), '{"kind":"wish","id":"40000000-0000-0000-0000-000000000003"}'));
select t_set(t_id('wish'), 'done');
select t_ok((select status from public.wish_items where id = '40000000-0000-0000-0000-000000000003') = 'done',
  'E7 a done plan of a wish: the wish is fulfilled (done)');
select t_set(t_id('wish'), 'open');
select t_ok((select status from public.wish_items where id = '40000000-0000-0000-0000-000000000003') = 'planned',
  'E7 unticked: the wish is planned again');
select t_set(t_id('wish'), 'done');
update public.wish_items set status = 'dropped' where id = '40000000-0000-0000-0000-000000000003';
select t_set(t_id('wish'), 'cancelled');
select t_ok((select status from public.wish_items where id = '40000000-0000-0000-0000-000000000003') = 'dropped',
  'E8 the owner''s own change after the tick is never undone (dropped stays dropped)');
-- Done by the tick, then put back to planned and marked done again by the owner (a later clock): the owner's.
reset role;
insert into public.wish_items (id, user_id, title, status) values ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Kayak trip', 'idea');
set role authenticated;
insert into public.t_keep values ('wish2', public.app_save_item(public.t_item('Paddle the fjord'), '{"kind":"wish","id":"40000000-0000-0000-0000-000000000004"}'));
select t_set(t_id('wish2'), 'done');
update public.wish_items set status = 'planned' where id = '40000000-0000-0000-0000-000000000004';
update public.wish_items set status = 'done' where id = '40000000-0000-0000-0000-000000000004';
select t_set(t_id('wish2'), 'open');
select t_ok((select status from public.wish_items where id = '40000000-0000-0000-0000-000000000004') = 'done',
  'E8 a wish the owner marked done again by hand after the tick stays done on untick (its clock moved)');

-- A project phase: done with its last open task; unticking that task opens it again.
reset role;
insert into public.project_phases (id, user_id, name, status) values ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Phase one', 'in_progress');
insert into public.tasks (id, user_id, title, project_phase_id) values
  ('92000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Draw it', '91000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Build it', '91000000-0000-0000-0000-000000000001');
set role authenticated;
select t_set('92000000-0000-0000-0000-000000000001', 'done');
select t_ok((select status from public.project_phases where id = '91000000-0000-0000-0000-000000000001') = 'in_progress',
  'E9 a phase with another open task stays open');
select t_set('92000000-0000-0000-0000-000000000002', 'done');
select t_ok((select status from public.project_phases where id = '91000000-0000-0000-0000-000000000001') = 'done'
        and (select done_at from public.project_phases where id = '91000000-0000-0000-0000-000000000001') is not null,
  'E9 its last open task done: the phase is done (done_at stamped)');
select t_set('92000000-0000-0000-0000-000000000002', 'open');
select t_ok((select status from public.project_phases where id = '91000000-0000-0000-0000-000000000001') = 'in_progress'
        and (select done_at from public.project_phases where id = '91000000-0000-0000-0000-000000000001') is null,
  'E9 that task reopened: the phase is back in progress');

-- Hand-ticked kinds: a football plan only closes.
reset role;
select t_set('70000000-0000-0000-0000-000000000031', 'done');
select t_ok((select count(*) from public.task_link_effects where task_id = '70000000-0000-0000-0000-000000000031') = 0,
  'E10 a football plan ticked: only the task closes');

-- ═══ Y. Synced kinds: the sync closes the plan; a hand tick writes no record ════
set role authenticated;
insert into public.t_keep values ('movie', public.app_save_item(public.t_item('Watch: Movie Two'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}'));
select t_set(t_id('movie'), 'done');
select t_ok(not exists (select 1 from public.media_watches where movie_entry_id = '10000000-0000-0000-0000-000000000002'),
  'Y1 a movie plan ticked by hand: the task closes, no watch is written (never a fake record)');
select t_set(t_id('movie'), 'open');
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'movie', '10000000-0000-0000-0000-000000000002', '2026-11-27 20:00+01');
select t_ok((t_task(t_id('movie'))).status = 'open', 'Y2 a watch the day before the plan''s day leaves it open');
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'movie', '10000000-0000-0000-0000-000000000002', '2026-11-28 21:30+01');
select t_ok((t_task(t_id('movie'))).status = 'done' and (t_task(t_id('movie'))).completed_at = '2026-11-28 21:30+01',
  'Y2 a watch on the plan''s day closes it, at the watch''s time');
reset role;
-- A watch from Trakt with no date closes nothing.
insert into public.t_keep values ('movie2', jsonb_build_object('taskId', gen_random_uuid()));
insert into public.tasks (id, user_id, title, movie_entry_id, due_date) values
  ((select t_id('movie2')), '00000000-0000-0000-0000-000000000001', 'Cinema: Movie Two', '10000000-0000-0000-0000-000000000002', '2026-11-29');
set app.trakt_sync = 'on';
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at, source) values
  ('00000000-0000-0000-0000-000000000001', 'movie', '10000000-0000-0000-0000-000000000002', null, 'trakt');
reset app.trakt_sync;
select t_ok((t_task(t_id('movie2'))).status = 'open', 'Y3 a watch with no date (from Trakt) closes nothing');
insert into public.media_watches (user_id, kind, movie_entry_id, watched_at) values
  ('00000000-0000-0000-0000-000000000001', 'movie', '10000000-0000-0000-0000-000000000002', '2026-12-01 18:00+01');
select t_ok((t_task(t_id('movie2'))).status = 'done', 'Y3 a watch after the plan''s day closes it (a cinema trip too)');

set role authenticated;
insert into public.t_keep values ('book', public.app_save_item(public.t_item('Read Book One'), '{"kind":"book","id":"60000000-0000-0000-0000-000000000001"}'));
insert into public.reading_page_events (book_id, page, started_at) values ('60000000-0000-0000-0000-000000000001', 10, '2026-11-27 22:00+01');
select t_ok((t_task(t_id('book'))).status = 'open', 'Y4 reading the day before leaves the book plan open');
insert into public.reading_page_events (book_id, page, started_at) values ('60000000-0000-0000-0000-000000000001', 11, '2026-11-28 21:00+01'),
                                                                        ('60000000-0000-0000-0000-000000000001', 12, '2026-11-28 21:02+01');
select t_ok((t_task(t_id('book'))).status = 'done' and (t_task(t_id('book'))).completed_at = '2026-11-28 21:00+01',
  'Y4 reading on the plan''s day closes it once, at the first page''s time');

-- A game: played on the plan's day, or its play time grew — never a plan whose day is ahead.
insert into public.t_keep values ('game', public.app_save_item(public.t_item('Play Game One', jsonb_build_object('date', ((now() at time zone 'Europe/Oslo')::date - 1)::text)),
  '{"kind":"game","id":"50000000-0000-0000-0000-000000000001"}'));
reset role;
update public.games set last_played_at = now() - interval '5 days' where id = '50000000-0000-0000-0000-000000000001';
select t_ok((t_task(t_id('game'))).status = 'open', 'Y5 played on another day: the game plan stays open');
-- A sync reporting more play time from a session before the plan was made (its last play then): still open.
update public.games set play_seconds = 1800 where id = '50000000-0000-0000-0000-000000000001';
select t_ok((t_task(t_id('game'))).status = 'open', 'Y5 play time that grew from a session before the plan was made closes nothing');
update public.games set play_seconds = 3600, last_played_at = now() where id = '50000000-0000-0000-0000-000000000001';
select t_ok((t_task(t_id('game'))).status = 'done', 'Y5 its play time grew from a session after the plan was made: closed');
set role authenticated;
insert into public.t_keep values ('game2', public.app_save_item(public.t_item('Play Game One again', jsonb_build_object('date', ((now() at time zone 'Europe/Oslo')::date + 3)::text)),
  '{"kind":"game","id":"50000000-0000-0000-0000-000000000001"}'));
reset role;
update public.games set play_seconds = 7200 where id = '50000000-0000-0000-0000-000000000001';
select t_ok((t_task(t_id('game2'))).status = 'open', 'Y6 a plan whose day is still ahead is never closed by play time');
-- Moved to today, then played today: closed by the day it was played.
update public.time_blocks set date = (now() at time zone 'Europe/Oslo')::date where task_id = t_id('game2');
update public.games set last_played_at = now() where id = '50000000-0000-0000-0000-000000000001';
select t_ok((t_task(t_id('game2'))).status = 'done', 'Y6 moved to today and played today: closed');

-- 141's title guess: never a task that plans something else, or a project's task.
insert into public.tasks (id, user_id, title, movie_entry_id) values
  ('93000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Push Day', '10000000-0000-0000-0000-000000000002');
insert into public.tasks (id, user_id, title, project_id) values
  ('93000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Push Day', gen_random_uuid());
insert into public.tasks (id, user_id, title) values
  ('93000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Push Day');
select t_ok((t_task('93000000-0000-0000-0000-000000000001')).hevy_routine_id is null
        and (t_task('93000000-0000-0000-0000-000000000002')).hevy_routine_id is null
        and (t_task('93000000-0000-0000-0000-000000000003')).hevy_routine_id = 'aaaaaaaa-0000-0000-0000-000000000001',
  'Y7 a task named like a routine that plans a movie, or a project''s task, is not guessed into training; a plain typed one still is');

-- ═══ T. One training identity (A4) ═══════════════════════════════════════════
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('hevy-1', '00000000-0000-0000-0000-000000000001', 'Push Day', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-10 16:00:00+00', '2026-11-10 17:00:00+00');
insert into public.health_workouts (id, user_id, name, start_time, end_time, raw) values
  ('apple-1', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-11-10 16:00:03+00', '2026-11-10 17:10:00+00',
   '{"source": {"name": "Ola Nordmann''s Apple Watch", "identifier": "com.hevyapp.hevy"}}'),
  ('watch-1', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-11-10 16:00:00+00', '2026-11-10 17:00:00+00',
   '{"source": {"name": "Ola Nordmann''s Apple Watch", "identifier": "com.apple.health.XYZ"}}');
select t_ok((select hevy_workout_id from public.health_workouts where id = 'apple-1') = 'hevy-1'
        and (select hevy_workout_id from public.health_workouts where id = 'watch-1') is null,
  'T1 Hevy''s row in Apple Health (3 s apart, its end 10 minutes later) is linked; the Watch''s own strength workout at the same second is not');
select t_ok(not exists (select 1 from public.health_workouts where raw::text like '%Nordmann%'),
  'T2 the Watch''s device name is never stored (dropped on every write)');
-- An older row without a source: by its name and start; a Hevy workout that arrives later links it.
insert into public.health_workouts (id, user_id, name, start_time, end_time) values
  ('apple-2', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-11-12 16:00:00+00', '2026-11-12 17:00:00+00'),
  ('apple-3', '00000000-0000-0000-0000-000000000001', 'Functional Strength Training', '2026-11-13 16:00:00+00', '2026-11-13 17:00:00+00');
insert into public.hevy_workouts (id, user_id, title, start_time, end_time) values
  ('hevy-2', '00000000-0000-0000-0000-000000000001', 'Pull Day', '2026-11-12 16:01:30+00', '2026-11-12 17:00:00+00'),
  ('hevy-3', '00000000-0000-0000-0000-000000000001', 'Legs', '2026-11-13 16:00:00+00', '2026-11-13 17:00:00+00'),
  ('hevy-4', '00000000-0000-0000-0000-000000000001', 'Late', '2026-11-14 16:00:00+00', '2026-11-14 17:00:00+00');
insert into public.health_workouts (id, user_id, name, start_time, end_time) values
  ('apple-4', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-11-14 16:02:30+00', '2026-11-14 17:00:00+00');
select t_ok((select hevy_workout_id from public.health_workouts where id = 'apple-2') = 'hevy-2'
        and (select hevy_workout_id from public.health_workouts where id = 'apple-3') is null
        and (select hevy_workout_id from public.health_workouts where id = 'apple-4') is null,
  'T3 an older row without a source: linked by "Traditional Strength Training" and a start within 2 minutes (the Hevy row arriving later); another name or 2.5 minutes apart is not');
-- A writer's own value is never taken; one Hevy workout is one Apple row.
set role authenticated;
update public.health_workouts set hevy_workout_id = 'hevy-4' where id = 'watch-1';
update public.health_workouts set hevy_workout_id = 'hevy-3' where id = 'apple-1';
select t_ok((select hevy_workout_id from public.health_workouts where id = 'watch-1') is null
        and (select hevy_workout_id from public.health_workouts where id = 'apple-1') = 'hevy-1',
  'T4 a link written by the browser is ignored: the database works it out (the Watch row stays unlinked, Hevy''s keeps its own)');
reset role;
select t_ok(t_refused($$insert into public.health_workouts (id, user_id, name, start_time, raw) values
  ('apple-1b', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-11-10 16:00:01+00', '{"source":{"identifier":"com.hevyapp.hevy"}}')$$) = 'written'
        and (select hevy_workout_id from public.health_workouts where id = 'apple-1b') is null,
  'T5 a second Apple row for a Hevy workout already linked stays unlinked (a session counts once)');
-- A Watch walk never closes a strength plan.
insert into public.tasks (id, user_id, title, source_type, source_id, hevy_routine_id, due_date) values
  ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Push Day', 'training_session', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-16');
insert into public.health_workouts (id, user_id, name, start_time, end_time, raw) values
  ('walk-1', '00000000-0000-0000-0000-000000000001', 'Outdoor Walk', '2026-11-16 08:00:00+00', '2026-11-16 09:00:00+00', '{"source":{"identifier":"com.apple.health.XYZ"}}'),
  ('watch-2', '00000000-0000-0000-0000-000000000001', 'Traditional Strength Training', '2026-11-16 16:00:00+00', '2026-11-16 17:00:00+00', '{"source":{"identifier":"com.apple.health.XYZ"}}');
select t_ok((t_task('94000000-0000-0000-0000-000000000001')).status = 'open' and (t_task('94000000-0000-0000-0000-000000000001')).hevy_workout_id is null
        and (select hevy_workout_id from public.health_workouts where id in ('walk-1', 'watch-2') and hevy_workout_id is not null) is null,
  'T6 a Watch walk and a Watch-only strength workout never close a strength plan and are never linked');
-- The gap: ticked by hand on Monday, trained on Tuesday (inside its week) — the workout links to that plan.
update public.tasks set status = 'done', completed_at = '2026-11-16 12:00+00' where id = '94000000-0000-0000-0000-000000000001';
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('hevy-5', '00000000-0000-0000-0000-000000000001', 'Push Day', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-17 16:00:00+00', '2026-11-17 17:00:00+00');
select t_ok((t_task('94000000-0000-0000-0000-000000000001')).hevy_workout_id = 'hevy-5'
        and (t_task('94000000-0000-0000-0000-000000000001')).status = 'done'
        and (t_task('94000000-0000-0000-0000-000000000001')).completed_at = '2026-11-16 12:00+00'
        and (select count(*) from public.tasks where hevy_workout_id = 'hevy-5') = 1,
  'T7 a plan ticked by hand on Monday takes its workout from Tuesday: one plan, linked, the tick''s time kept');
-- A plan still to do that week comes first.
insert into public.tasks (id, user_id, title, source_type, source_id, hevy_routine_id, due_date, status, completed_at) values
  ('94000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Push Day', 'training_session', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-18', 'done', '2026-11-18 07:00+00'),
  ('94000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Push Day', 'training_session', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-19', 'open', null);
insert into public.hevy_workouts (id, user_id, title, routine_id, start_time, end_time) values
  ('hevy-6', '00000000-0000-0000-0000-000000000001', 'Push Day', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-20 16:00:00+00', '2026-11-20 17:00:00+00');
select t_ok((t_task('94000000-0000-0000-0000-000000000003')).hevy_workout_id = 'hevy-6'
        and (t_task('94000000-0000-0000-0000-000000000002')).hevy_workout_id is null,
  'T7 a session still to do that week takes the workout before one ticked by hand');

-- ═══ F. Football's Plan it in one save ═══════════════════════════════════════
set role authenticated;
insert into public.t_keep values ('fb', public.app_save_item(public.t_item('Brann – Rosenborg'),
  '{"kind":"football","match":{"eventId":"700999","league":"nor-1","kickoffAt":"2026-11-29T17:00:00Z","timeValid":true}}'));
select t_ok((select task_id from public.football_plans where event_id = '700999') = t_id('fb')
        and (t_task(t_id('fb'))).football_plan_id = (select id from public.football_plans where event_id = '700999')
        and (select v #>> '{link,kind}' from public.t_keep where k = 'fb') = 'football',
  'F1 Plan it: the item, the match record and the task''s link in one save');
insert into public.t_keep values ('fbn', to_jsonb((select count(*) from public.tasks)));
select t_ok(t_refused($$select public.app_save_item(public.t_item('Brann – Rosenborg again'),
  '{"kind":"football","match":{"eventId":"700999","league":"nor-1","kickoffAt":"2026-11-29T17:00:00Z"}}')$$) like 'IT012%'
        and (select count(*) from public.tasks) = (select v::bigint from public.t_keep where k = 'fbn'),
  'F2 the same match again: "planned already", nothing written');
select t_ok(t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"football","match":{"eventId":"7; drop","league":"nor-1","kickoffAt":"2026-11-29T17:00:00Z"}}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"football","match":{"eventId":"7001","league":"NOR 1","kickoffAt":"2026-11-29T17:00:00Z"}}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"football","match":{"eventId":"7001","league":"nor-1","kickoffAt":"soon"}}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"movie","match":{"eventId":"7001","league":"nor-1","kickoffAt":"2026-11-29T17:00:00Z"}}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"football","match":{"eventId":"7001","league":"nor-1","kickoffAt":"2026-11-29T17:00:00Z","url":"x"}}')$$) like '22023%'
        and (select count(*) from public.tasks) = (select v::bigint from public.t_keep where k = 'fbn'),
  'F3 a bad event id, league, kick-off, kind or key is refused, nothing written');
reset role;

-- ═══ S. Who writes what ══════════════════════════════════════════════════════
insert into public.tasks (id, user_id, title) values ('95000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Theirs');
select t_ok(t_refused($$insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, task_id)
  values ('00000000-0000-0000-0000-000000000001', '2026-11-28', 'Mine on their task', '10:00', 30, '95000000-0000-0000-0000-000000000002')$$) like '23503%',
  'S0 a slot can''t name another account''s task (a plan''s day is read from its slot)');
set role authenticated;
select t_ok(t_refused($$insert into public.notifications (user_id, kind, dedupe_key) values ('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', 'x:00000000-0000-0000-0000-000000000000')$$) like '42501%'
        and t_refused($$insert into public.task_link_effects (task_id, effect, user_id, target_id, before, after) values (gen_random_uuid(), 'wish_done', '00000000-0000-0000-0000-000000000001', gen_random_uuid(), '{}', '{}')$$) like '42501%'
        and t_refused($$select public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', null, null, 'x:00000000-0000-0000-0000-000000000000')$$) like '42501%'
        and t_refused($$delete from public.notifications$$) like '42501%',
  'S1 the browser can''t write a notification, the ledger or call notify()');
reset role;
select public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', 'shop_item', '30000000-0000-0000-0000-000000000001', 'shop_bought:00000000-0000-0000-0000-0000000000aa');
select public.notify('00000000-0000-0000-0000-000000000002', 'shop_bought_draft', 'shop_item', '30000000-0000-0000-0000-000000000009', 'shop_bought:00000000-0000-0000-0000-0000000000bb');
set role authenticated;
select t_ok(t_refused($$update public.notifications set kind = 'shop_bought_draft', link_id = null where dedupe_key = 'shop_bought:00000000-0000-0000-0000-0000000000aa'$$) like '42501%',
  'S2 the browser may change only read_at');
update public.notifications set read_at = now() where dedupe_key = 'shop_bought:00000000-0000-0000-0000-0000000000aa';
select t_ok((select read_at from public.notifications where dedupe_key = 'shop_bought:00000000-0000-0000-0000-0000000000aa') is not null
        and not exists (select 1 from public.notifications where dedupe_key = 'shop_bought:00000000-0000-0000-0000-0000000000bb'),
  'S2 … marks its own as read, and never sees another account''s');
reset role;
select t_ok(public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', 'shop_item', '30000000-0000-0000-0000-000000000001', 'shop_bought:00000000-0000-0000-0000-0000000000aa') is null
        and (select count(*) from public.notifications where dedupe_key = 'shop_bought:00000000-0000-0000-0000-0000000000aa') = 1,
  'S3 notify() twice with one dedupe key: one notice');
select t_ok(t_refused($$select public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', 'shop_item', null, 'shop_bought:00000000-0000-0000-0000-0000000000cc')$$) like '23514%'
        and t_refused($$select public.notify('00000000-0000-0000-0000-000000000001', 'phish', null, null, 'shop_bought:00000000-0000-0000-0000-0000000000cc')$$) like '23514%'
        and t_refused($$select public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', null, null, 'https://example.com/x')$$) like '23514%',
  'S3 a link kind without its id, an unknown kind or a key that is not "kind:uuid" is refused');
select t_ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name in ('url', 'href', 'link', 'title', 'body')),
  'S4 notifications has no URL (or text) column: the screen builds the way to the thing from its kind');
