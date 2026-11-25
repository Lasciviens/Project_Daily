-- Migration 210 (a task's link to the thing it plans) on the live item chain (135–193) with the old links of
-- seed.sql, after 210 ran twice (scripts/verify-db-task-links.mjs). Setup and checks run as the superuser (a writer
-- without row security, as the service role is); app writes as `authenticated` (test.uid picks the caller: unset =
-- the owner, user 2 = another allowed account). Ids are seed.sql's: 1000… movies, 2000… shows, 3000… shop items,
-- 4000… wishes, 5000… a game, 6000… a book, 7000… tasks, 8000… a match record, aaaa… routines.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
-- A statement that must be refused: its error's code (and text), or 'written'.
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

-- ═══ M. The data move ════════════════════════════════════════════════════════
select t_ok((select count(*) from public.tasks) = (select count(*) from public.t_before)
        and not exists (select 1 from public.t_before b where not exists (
              select 1 from public.tasks t where t.id = b.id and t.status = b.status and t.title = b.title)),
  'M1 NEVER_HIDES: every task is still there, its status and title as they were');
select t_ok((t_task('70000000-0000-0000-0000-000000000002')).movie_entry_id = '10000000-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000001')).movie_entry_id is null
        and (t_task('70000000-0000-0000-0000-000000000001')).source_type = 'movie',
  'M2 two open plans of one movie: the newest takes the link, the older keeps its label without it');
select t_ok((t_task('70000000-0000-0000-0000-000000000003')).movie_entry_id = '10000000-0000-0000-0000-000000000001',
  'M2 a watched (done) plan of the same movie keeps its link too');
select t_ok((t_task('70000000-0000-0000-0000-000000000004')).movie_entry_id is null,
  'M2 a label naming another account''s movie is not linked');
select t_ok((t_task('70000000-0000-0000-0000-000000000005')).tv_entry_id = '20000000-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000005')).link_season = 1 and (t_task('70000000-0000-0000-0000-000000000005')).link_episode = 2
        and (t_task('70000000-0000-0000-0000-000000000006')).tv_entry_id = '20000000-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000006')).link_episode is null,
  'M3 a show''s plans link the show; the one-episode plan its slot''s season and episode, the batch none');
select t_ok((t_task('70000000-0000-0000-0000-000000000011')).shop_item_id = '30000000-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000011')).source_type = 'shop_item'
        and (t_task('70000000-0000-0000-0000-000000000011')).source_id = '30000000-0000-0000-0000-000000000001',
  'M4 shop_items.task_id copied; the label follows the link');
select t_ok((t_task('70000000-0000-0000-0000-000000000012')).shop_item_id = '30000000-0000-0000-0000-000000000003'
        and (select task_id from public.shop_items where id = '30000000-0000-0000-0000-000000000002') = '70000000-0000-0000-0000-000000000012',
  'M4 a task named by two shop items takes the newer; the older keeps its old pointer');
select t_ok((t_task('70000000-0000-0000-0000-000000000013')).hevy_routine_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000013')).shop_item_id is null
        and (select task_id from public.shop_items where id = '30000000-0000-0000-0000-000000000004') = '70000000-0000-0000-0000-000000000013',
  'M4 a training plan keeps its routine; the shop pointer at it stays as it was (one link per task)');
select t_ok((t_task('70000000-0000-0000-0000-000000000021')).wish_item_id = '40000000-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000021')).source_type = 'wish'
        and (t_task('70000000-0000-0000-0000-000000000022')).wish_item_id = '40000000-0000-0000-0000-000000000002'
        and (select status from public.wish_items where id = '40000000-0000-0000-0000-000000000002') = 'idea',
  'M5 wish_items.promoted_task_id copied; a wish the owner put back to idea stays an idea');
select t_ok((t_task('70000000-0000-0000-0000-000000000031')).football_plan_id = '80000000-0000-0000-0000-000000000001'
        and (t_task('70000000-0000-0000-0000-000000000031')).source_type = 'football',
  'M6 football_plans.task_id copied');
select t_ok((t_task('70000000-0000-0000-0000-000000000099')).source_type = 'manual'
        and num_nonnulls((t_task('70000000-0000-0000-0000-000000000099')).movie_entry_id, (t_task('70000000-0000-0000-0000-000000000099')).shop_item_id,
                         (t_task('70000000-0000-0000-0000-000000000099')).wish_item_id, (t_task('70000000-0000-0000-0000-000000000099')).football_plan_id) = 0,
  'M7 a task with no old link is left alone');
select t_ok(not exists (
    select 1 from public.t_after1 a join public.tasks t using (id)
     where (a.source_type, a.source_id, a.hevy_routine_id, a.movie_entry_id, a.tv_entry_id, a.link_season, a.link_episode, a.shop_item_id,
            a.wish_item_id, a.football_plan_id, a.game_id, a.book_id, a.status, a.title)
           is distinct from
           (t.source_type, t.source_id, t.hevy_routine_id, t.movie_entry_id, t.tv_entry_id, t.link_season, t.link_episode, t.shop_item_id,
            t.wish_item_id, t.football_plan_id, t.game_id, t.book_id, t.status, t.title))
        and (select count(*) from public.t_after1) = (select count(*) from public.tasks)
        and not exists (
    select 1 from public.t_old1 o
     where not exists (select 1 from (select 's' k, id, task_id t, null::text st from public.shop_items
                                      union all select 'w', id, promoted_task_id, status from public.wish_items
                                      union all select 'f', id, task_id, null from public.football_plans) n
                        where n.k = o.k and n.id = o.id and n.t is not distinct from o.t and n.st is not distinct from o.st)),
  'M8 the second run changed nothing: the links, labels and old pointers are as the first run left them');

-- ═══ A. One link per task (the arc) ══════════════════════════════════════════
select t_ok(t_refused($$update public.tasks set game_id = '50000000-0000-0000-0000-000000000001'
                       where id = '70000000-0000-0000-0000-000000000011'$$) like '23514%tasks_one_link%',
  'A1 a second link on a task is refused (tasks_one_link)');
select t_ok(t_refused($$update public.tasks set hevy_routine_id = 'aaaaaaaa-0000-0000-0000-000000000001', source_type = 'training_session'
                       where id = '70000000-0000-0000-0000-000000000031'$$) like '23514%tasks_one_link%',
  'A1 the routine is part of the arc: a match plan can''t also plan a routine');
select t_ok(t_refused($$update public.tasks set link_season = 1 where id = '70000000-0000-0000-0000-000000000006'$$) like '23514%tasks_link_episode%',
  'A2 an episode is a season AND an episode number');
insert into public.user_tv_entries (id, user_id, title) values ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Show Two');
insert into public.tasks (id, user_id, title, tv_entry_id, link_season, link_episode)
values ('70000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', 'Show Two S02E01', '20000000-0000-0000-0000-000000000002', 2, 1);
delete from public.user_tv_entries where id = '20000000-0000-0000-0000-000000000002';
select t_ok((t_task('70000000-0000-0000-0000-000000000041')).tv_entry_id is null and (t_task('70000000-0000-0000-0000-000000000041')).link_episode is null
        and (t_task('70000000-0000-0000-0000-000000000041')).source_type = 'tv_series',
  'A3 deleting the show keeps the task: the link and the episode go (ON DELETE SET NULL), the label stays');

-- ═══ O. One open plan per thing ══════════════════════════════════════════════
select t_ok(t_refused($$insert into public.tasks (user_id, title, movie_entry_id)
                       values ('00000000-0000-0000-0000-000000000001', 'Movie One again', '10000000-0000-0000-0000-000000000001')$$) like '23505%tasks_open_plan_movie%',
  'O1 a second open plan of one movie is refused (tasks_open_plan_movie)');
select t_ok(t_refused($$insert into public.tasks (user_id, title, status, movie_entry_id)
                       values ('00000000-0000-0000-0000-000000000001', 'Movie One, seen before', 'done', '10000000-0000-0000-0000-000000000001')$$) = 'written',
  'O2 a done plan of the same movie is allowed beside the open one');
update public.tasks set status = 'done' where id = '70000000-0000-0000-0000-000000000002';
select t_ok(t_refused($$insert into public.tasks (id, user_id, title, movie_entry_id)
                       values ('70000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000001', 'Movie One rewatch', '10000000-0000-0000-0000-000000000001')$$) = 'written',
  'O3 once the plan is done a new plan of the movie is allowed (a rewatch)');
select t_ok(t_refused($$update public.tasks set status = 'open' where id = '70000000-0000-0000-0000-000000000002'$$) like '23505%tasks_open_plan_movie%',
  'O3 reopening the old plan while the new one is open is refused, not a second open plan');
select t_ok(t_refused($$insert into public.tasks (user_id, title, tv_entry_id, link_season, link_episode)
                       values ('00000000-0000-0000-0000-000000000001', 'S01E02 again', '20000000-0000-0000-0000-000000000001', 1, 2)$$) like '23505%tasks_open_plan_episode%'
        and t_refused($$insert into public.tasks (user_id, title, tv_entry_id, link_season, link_episode)
                       values ('00000000-0000-0000-0000-000000000001', 'S01E03', '20000000-0000-0000-0000-000000000001', 1, 3)$$) = 'written'
        and t_refused($$insert into public.tasks (user_id, title, tv_entry_id)
                       values ('00000000-0000-0000-0000-000000000001', 'Show One, a few more', '20000000-0000-0000-0000-000000000001')$$) = 'written',
  'O4 one open plan per episode; another episode, or a batch of the show, is allowed');
select t_ok(t_refused($$insert into public.tasks (user_id, title, source_type, source_id, hevy_routine_id)
                       values ('00000000-0000-0000-0000-000000000001', 'Push Day', 'training_session', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001')$$) = 'written',
  'O5 a routine may have several open sessions (a weekly plan): training is not held to one open plan');

-- ═══ S. Whose the thing is ═══════════════════════════════════════════════════
select t_ok(t_refused($$update public.tasks set shop_item_id = '30000000-0000-0000-0000-000000000009'
                       where id = '70000000-0000-0000-0000-000000000099'$$) like 'IT011%',
  'S1 a writer without row security (the service role) can''t link a task to another account''s thing');
set role authenticated;
select t_ok(t_refused($$update public.tasks set movie_entry_id = '10000000-0000-0000-0000-000000000009'
                       where id = '70000000-0000-0000-0000-000000000099'$$) like 'IT011%',
  'S2 the owner''s browser can''t link its task to another account''s movie by a direct write');
insert into public.t_keep values ('n', to_jsonb((select count(*) from public.tasks)));
select t_ok(t_refused($$select public.app_save_item(public.t_item('Not mine'), '{"kind":"shop_item","id":"30000000-0000-0000-0000-000000000009"}')$$) like 'IT011%'
        and (select count(*) from public.tasks) = (select v::bigint from public.t_keep where k = 'n'),
  'S3 the save with another account''s shop item is refused before anything is written');
select t_ok(t_refused($$select public.app_save_item(public.t_item('Not mine'), '{"kind":"training","id":"aaaaaaaa-0000-0000-0000-000000000009"}')$$) like 'IT011%',
  'S3 the same for another account''s routine');
select t_ok(t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"url","id":"10000000-0000-0000-0000-000000000001"}')$$) like '22023%unknown link kind%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000001; drop table x"}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002","season":1,"episode":2}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002","href":"x"}')$$) like '22023%'
        and t_refused($$select public.app_save_item(public.t_item('x'), '["movie"]')$$) like '22023%'
        and (select count(*) from public.tasks) = (select v::bigint from public.t_keep where k = 'n'),
  'S4 an unknown kind, a bad id, an episode on a movie, an unknown key or a non-object is refused, nothing written');
reset role;
set test.uid = '00000000-0000-0000-0000-000000000002';
set role authenticated;
select t_ok(t_refused($$select public.app_save_item(public.t_item('Theirs'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}')$$) like 'IT011%',
  'S5 another allowed account can''t link to the owner''s movie');
reset role;
reset test.uid;

-- ═══ E. The item save with its link ══════════════════════════════════════════
set role authenticated;
insert into public.t_keep values ('e1', public.app_save_item(public.t_item('Buy a kettle'), '{"kind":"shop_item","id":"30000000-0000-0000-0000-000000000005"}'));
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e1'))).shop_item_id = '30000000-0000-0000-0000-000000000005'
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e1'))).source_type = 'shop_item'
        and (select task_id from public.shop_items where id = '30000000-0000-0000-0000-000000000005') = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'e1')
        and (select v #>> '{link,kind}' from public.t_keep where k = 'e1') = 'shop_item',
  'E1 Plan it for a shop item: the task, its link and shop_items.task_id in one save');
insert into public.t_keep values ('e2', public.app_save_item(public.t_item('Go to the museum'), '{"kind":"wish","id":"40000000-0000-0000-0000-000000000003"}'));
select t_ok((select status from public.wish_items where id = '40000000-0000-0000-0000-000000000003') = 'planned'
        and (select promoted_task_id from public.wish_items where id = '40000000-0000-0000-0000-000000000003') = (select (v ->> 'taskId')::uuid from public.t_keep where k = 'e2'),
  'E2 Plan it for a wish: the idea becomes planned and records its task');
insert into public.t_keep values ('e3', public.app_save_item(public.t_item('Watch: Movie Two', '{"source":{"type":"movie","id":"10000000-0000-0000-0000-000000000002"}}'),
  '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}'));
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e3'))).movie_entry_id = '10000000-0000-0000-0000-000000000002',
  'E3 a movie plan links its movie');
insert into public.t_keep values ('n2', to_jsonb((select count(*) from public.tasks)));
select t_ok(t_refused($$select public.app_save_item(public.t_item('Watch: Movie Two again'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}')$$) like 'IT012%'
        and (select count(*) from public.tasks) = (select v::bigint from public.t_keep where k = 'n2'),
  'E4 planning the same movie again is refused with "planned already", and no task is left behind');
select t_ok(t_refused($$select public.app_save_item(public.t_item('Watch: Movie Two, again'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}')$$) like 'IT012%'
        and t_refused(format($q$select public.app_save_item(public.t_item('Watch: Movie Two (renamed)', '{"taskId":"%s"}'), '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}')$q$,
                             (select v ->> 'taskId' from public.t_keep where k = 'e3'))) = 'written',
  'E5 an edit of the plan itself with its own link is not "planned already"');
insert into public.t_keep values ('e6', public.app_save_item(public.t_item('Show One S01E05'), '{"kind":"tv","id":"20000000-0000-0000-0000-000000000001","season":1,"episode":5}'));
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e6'))).link_episode = 5
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e6'))).source_type = 'tv_series',
  'E6 an episode plan links the show, season and episode');
insert into public.t_keep values ('e7', public.app_save_item(public.t_item('Play Game One'), '{"kind":"game","id":"50000000-0000-0000-0000-000000000001"}'));
insert into public.t_keep values ('e8', public.app_save_item(public.t_item('Read Book One'), '{"kind":"book","id":"60000000-0000-0000-0000-000000000001"}'));
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e7'))).game_id = '50000000-0000-0000-0000-000000000001'
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e7'))).source_type = 'game'
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e8'))).book_id = '60000000-0000-0000-0000-000000000001',
  'E7 a game and a book plan link their thing');
insert into public.t_keep values ('e9', public.app_save_item(public.t_item('Push Day', '{"source":{"type":"training_session","id":"aaaaaaaa-0000-0000-0000-000000000001"}}'),
  '{"kind":"training","id":"aaaaaaaa-0000-0000-0000-000000000001"}'));
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e9'))).hevy_routine_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e9'))).source_type = 'training_session',
  'E8 a training plan names its routine (several open sessions of one routine allowed)');
insert into public.t_keep values ('e10', public.app_save_item(public.t_item('Weekly film night', '{"repeat":{"kind":"weekly","daysOfWeek":[5]}}'),
  '{"kind":"movie","id":"10000000-0000-0000-0000-000000000002"}'));
select t_ok((select v -> 'link' = 'null'::jsonb and v ->> 'scheduleBlockId' is not null from public.t_keep where k = 'e10'),
  'E9 a repeating item has no task of its own: saved, and the answer says no link');
select t_ok((select (public.app_save_item(public.t_item('Plain', '{"google":"none"}')) ->> 'taskId') is not null),
  'E10 the 1-argument save works as before (163''s app_football_plan, an old website)');
-- An old website's movie plan (no p_link): its label still links the movie.
insert into public.t_keep values ('e11', public.app_save_item(public.t_item('Watch: Movie One', '{"source":{"type":"movie","id":"10000000-0000-0000-0000-000000000001"}}')));
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e11'))).movie_entry_id is null,
  'E11 an old website''s second open plan of a movie is saved without the link (the open one keeps it)');
select t_ok(t_refused(format($q$update public.tasks set status = 'done' where id = '%s'$q$, (select v ->> 'taskId' from public.t_keep where k = 'e11'))) = 'written',
  'E11 and it can be ticked like any task');
reset role;

-- ═══ D. The old pointers in step (one release) ═══════════════════════════════
set role authenticated;
insert into public.shop_items (id, user_id, title, task_id)
values ('30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Rope', '70000000-0000-0000-0000-000000000099');
select t_ok((t_task('70000000-0000-0000-0000-000000000099')).shop_item_id = '30000000-0000-0000-0000-000000000006'
        and (t_task('70000000-0000-0000-0000-000000000099')).source_type = 'shop_item',
  'D1 an old writer setting shop_items.task_id links the task');
update public.shop_items set task_id = null where id = '30000000-0000-0000-0000-000000000006';
select t_ok((t_task('70000000-0000-0000-0000-000000000099')).shop_item_id is null,
  'D2 clearing the old pointer clears the link');
select t_ok(t_refused($$update public.tasks set wish_item_id = '40000000-0000-0000-0000-000000000003'
                       where id = '70000000-0000-0000-0000-000000000099'$$) like '23505%tasks_open_plan_wish%',
  'D3 a direct link to a wish another open plan holds is refused');
update public.wish_items set promoted_task_id = '70000000-0000-0000-0000-000000000099' where id = '40000000-0000-0000-0000-000000000003';
select t_ok((t_task('70000000-0000-0000-0000-000000000099')).wish_item_id = '40000000-0000-0000-0000-000000000003'
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e2'))).wish_item_id is null,
  'D3 an old writer moving the wish''s pointer moves the link; the earlier open plan gives it up');
reset role;
insert into public.football_plans (id, user_id, event_id, league, task_id, kickoff_at)
values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '700124', 'nor-1', (select (v ->> 'taskId')::uuid from public.t_keep where k = 'e8'), '2026-11-30 17:00+00');
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e8'))).book_id = '60000000-0000-0000-0000-000000000001'
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e8'))).football_plan_id is null,
  'D4 an old pointer at a task that already plans something else leaves its link alone');
delete from public.shop_items where id = '30000000-0000-0000-0000-000000000005';
select t_ok((t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e1'))).id is not null
        and (t_task((select (v ->> 'taskId')::uuid from public.t_keep where k = 'e1'))).shop_item_id is null,
  'D5 deleting the shop item keeps its task, unlinked');
delete from public.tasks where id = '70000000-0000-0000-0000-000000000011';
select t_ok((select task_id from public.shop_items where id = '30000000-0000-0000-0000-000000000001') is null,
  'D6 deleting the task clears the old pointer as before');
