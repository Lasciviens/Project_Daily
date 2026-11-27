-- Migration 215 (an item's category add-on fields: tasks.details, its allow-list for every writer, the item save with
-- its details) on the item chain with 210 and 211, after 215 ran twice (scripts/verify-db-item-details.mjs). Setup and
-- checks run as the superuser; app writes as `authenticated` (test.uid picks the caller: unset = the owner, user 2 =
-- another allowed account). A film and a game of the owner's are made here. Made-up data only.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb, tx bigint);
grant all on public.t_keep to authenticated;
-- The SQLSTATE a statement fails with, or 'written'.
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'written';
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_err(text) to authenticated;
create or replace function public.t_item(p_title text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'domain', 'media', 'priority', 'medium', 'date', '2026-11-28',
    'time', '19:00', 'durationMinutes', 120, 'google', 'none', 'today', '2026-11-27', 'category', 'media') || extra
$$;
grant execute on function public.t_item(text, jsonb) to authenticated;
create or replace function public.t_id(p_k text) returns uuid language sql as $$
  select (v ->> 'taskId')::uuid from public.t_keep where k = p_k
$$;
grant execute on function public.t_id(text) to authenticated;
create or replace function public.t_details(p uuid) returns jsonb language sql security definer set search_path = '' as $$
  select details from public.tasks where id = p
$$;
grant execute on function public.t_details(uuid) to authenticated;

insert into public.user_movie_entries (id, user_id, title) values ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'Film One');
insert into public.games (id, user_id, title) values ('50000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'Game One (details)');

-- ═══ R. The runs ═════════════════════════════════════════════════════════════
select t_ok((select count(*) from public.tasks) = (select count(*) from public.t_before215)
        and not exists (select 1 from public.t_before215 b where not exists (
              select 1 from public.tasks t where t.id = b.id and t.status = b.status and t.title = b.title and t.details is null)),
  'R1 NEVER_HIDES: every task is still there after 215 ran twice, as it was, with no details');
select t_ok((select count(*) from pg_constraint where conname = 'tasks_details_ok') = 1
        and (select count(*) from pg_proc where proname = 'app_save_item') = 3,
  'R2 one CHECK on the column, and the save''s three signatures (item; item + link; item + link + details)');

-- ═══ S. The save with its details ════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_save_item(public.t_item('Cinema: Film One'), '{"kind":"movie","id":"10000000-0000-0000-0000-0000000000d1"}',
    '{"category":"media","type":"cinema","with":["Ola","Kari Nordmann"],"cost":{"amount":149.5,"currency":"NOK"},"seats":"H12–H13","booking":"AB12CD"}');
  insert into public.t_keep values ('cinema', r, txid_current());
  perform t_ok(r -> 'details' ->> 'type' = 'cinema' and r -> 'link' ->> 'kind' = 'movie'
    and (select movie_entry_id = '10000000-0000-0000-0000-0000000000d1' and details -> 'cost' ->> 'amount' = '149.5'
           and details -> 'with' = '["Ola","Kari Nordmann"]' and details ->> 'booking' = 'AB12CD'
           from public.tasks where id = (r ->> 'taskId')::uuid),
    'S1 a cinema trip: the movie is the task''s link, its details (with who, cost, seats, booking) saved in the same save');
end $$;
do $$
declare r jsonb;
begin
  r := public.app_save_item(public.t_item('🎮 Game One', '{"category":"games"}'), '{"kind":"game","id":"50000000-0000-0000-0000-0000000000d1"}',
    '{"category":"games","on":"RP6","with":["Kari"]}');
  insert into public.t_keep values ('game', r, txid_current());
  perform t_ok((select game_id = '50000000-0000-0000-0000-0000000000d1' and details = '{"category":"games","on":"RP6","with":["Kari"]}'
                  from public.tasks where id = (r ->> 'taskId')::uuid),
    'S2 a game plan: the game is the link, On and with who are its details');
end $$;
do $$
declare r jsonb;
begin
  r := public.app_save_item(public.t_item('Read the manual', '{"category":"work","date":null,"time":null,"durationMinutes":null}'), null,
    '{"category":"work"}');
  perform t_ok(r -> 'link' is null and r ->> 'blockId' is null and t_details((r ->> 'taskId')::uuid) = '{"category":"work"}',
    'S3 an item with no slot keeps its category in its details (no link, no slot)');
end $$;

-- An edit: absent = keep, null = none.
do $$
declare r jsonb;
begin
  r := public.app_save_item(public.t_item('Cinema: Film One, late show', jsonb_build_object('taskId', t_id('cinema'), 'time', '21:00')));
  perform t_ok(t_details(t_id('cinema')) ->> 'seats' = 'H12–H13',
    'S4 a save without details (the 1-argument call, every older writer) keeps them');
  r := public.app_save_item(public.t_item('Cinema: Film One, late show', jsonb_build_object('taskId', t_id('cinema'))),
    null, '{"category":"media","type":"cinema","with":["Ola"],"seats":"J4"}');
  perform t_ok(t_details(t_id('cinema')) = '{"category":"media","type":"cinema","with":["Ola"],"seats":"J4"}'
      and (select movie_entry_id from public.tasks where id = t_id('cinema')) = '10000000-0000-0000-0000-0000000000d1',
    'S5 an edit''s details replace them as a whole; no link sent = the link kept');
  insert into public.t_keep values ('cinema-edit', r, txid_current());
end $$;
do $$
declare r jsonb;
begin
  r := public.app_save_item(public.t_item('Rewatch', '{"repeat":{"kind":"weekly","daysOfWeek":[5],"startsOn":"2026-11-27"}}'), null,
    '{"category":"media","type":"movie"}');
  perform t_ok(r ->> 'scheduleBlockId' is not null and r ->> 'taskId' is null and r -> 'details' = 'null'::jsonb
      and not exists (select 1 from public.tasks where schedule_block_id = (r ->> 'scheduleBlockId')::uuid and details is not null),
    'S6 a repeating item has no task of its own: it saves and answers details null, no day''s task gets them');
end $$;

-- ═══ C. The allow-list, for every writer ═════════════════════════════════════
select t_ok(public.t_err(format('select public.app_save_item(public.t_item(%L), null, %L)', 'Bad', d)) = '22023'
    and (select count(*) from public.tasks where title = 'Bad') = 0, 'C1 refused before anything is written: ' || why)
  from (values
    ('{"category":"media","script":"x"}', 'an unknown key'),
    ('{"category":"cinema"}', 'a category not on the list'),
    ('{"category":"media","type":"concert"}', 'a media type not on the list'),
    ('{"category":"media","type":"movie","cost":{"amount":10,"currency":"NOK"}}', 'a cost on a movie at home (cinema only)'),
    ('{"category":"media","on":"PS5"}', 'Games'' On on a media item'),
    ('{"category":"games","seats":"A1"}', 'seats on a game'),
    ('{"category":"work","with":["Ola"]}', 'with who on a category with no add-on fields'),
    ('{"category":"media","with":["' || repeat('x', 41) || '"]}', 'a name of 41 characters'),
    ('{"category":"media","with":["a","b","c","d","e","f","g","h","i","j","k"]}', 'eleven names'),
    ('{"category":"media","with":[]}', 'an empty list of names'),
    ('{"category":"media","with":["   "]}', 'a name of spaces only'),
    ('{"category":"media","with":["Ola\u0007"]}', 'a control character in a name'),
    ('{"category":"media","with":"Ola"}', 'names that are not a list'),
    ('{"category":"media","with":[42]}', 'a name that is not text'),
    ('{"category":"media","type":"cinema","cost":{"amount":-1,"currency":"NOK"}}', 'a negative cost'),
    ('{"category":"media","type":"cinema","cost":{"amount":1000001,"currency":"NOK"}}', 'a cost over a million'),
    ('{"category":"media","type":"cinema","cost":{"amount":10.005,"currency":"NOK"}}', 'a cost with three decimals'),
    ('{"category":"media","type":"cinema","cost":{"amount":"10","currency":"NOK"}}', 'a cost given as text'),
    ('{"category":"media","type":"cinema","cost":{"amount":10,"currency":"BTC"}}', 'a currency not on the list'),
    ('{"category":"media","type":"cinema","cost":{"amount":10,"currency":"NOK","toSpending":true}}', 'an unknown key in the cost'),
    ('{"category":"media","type":"cinema","seats":"' || repeat('x', 61) || '"}', 'seats of 61 characters'),
    ('{"category":"media","type":"cinema","booking":"' || repeat(' ', 30) || '"}', 'a booking of spaces only'),
    ('{"category":"games","on":"' || repeat('x', 31) || '"}', 'On of 31 characters'),
    ('["media"]', 'a list instead of an object'),
    ('"media"', 'a string instead of an object')
  ) as v(d, why);
reset role;
select t_ok(public.t_err($$update public.tasks set details = '{"category":"media","type":"cinema","cost":{"amount":-5,"currency":"NOK"}}' where title = 'Read the manual'$$) = '23514'
    and public.t_err($$update public.tasks set details = '{"category":"games","on":"PS5","url":"https://example.com"}' where title = 'Read the manual'$$) = '23514',
  'C2 a direct write (any writer — a sync, the service role, plain SQL) meets the same allow-list (the CHECK)');
create table public.t_counts as select (select count(*) from public.icloud_outbox) icloud, (select count(*) from public.google_tasks_outbox) google;
set role authenticated;
insert into public.t_keep values ('c3', to_jsonb(public.t_err($$update public.tasks set details = '{"category":"games","on":"PS5"}' where title = 'Read the manual'$$)), null);
select t_ok((select v #>> '{}' from public.t_keep where k = 'c3') = 'written'
    and (select details ->> 'on' from public.tasks where title = 'Read the manual') = 'PS5',
  'C3 a direct write of allowed details is taken (the CHECK, not the save, is the rule)');

-- ═══ O. Whose it is ══════════════════════════════════════════════════════════
select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
insert into public.t_keep values ('o1', to_jsonb(public.t_err(format('select public.app_save_item(public.t_item(%L, %L), null, %L)', 'Taken over',
      jsonb_build_object('taskId', public.t_id('game')), '{"category":"games","on":"Stolen"}'))), null);
select t_ok((select v #>> '{}' from public.t_keep where k = 'o1') <> 'written'
    and public.t_details(public.t_id('game')) ->> 'on' = 'RP6',
  'O1 another account cannot write details onto the owner''s task through the save');
insert into public.t_keep values ('o2', to_jsonb(public.t_err(format($$update public.tasks set details = '{"category":"games","on":"Stolen"}' where id = %L$$, public.t_id('game')))), null);
select t_ok((select v #>> '{}' from public.t_keep where k = 'o2') = 'written'
    and public.t_details(public.t_id('game')) ->> 'on' = 'RP6',
  'O2 …nor by a direct write (row security: the update reaches no row)');
select set_config('test.uid', '', false);

-- ═══ Q. Nothing leaves the app ═══════════════════════════════════════════════
reset role;
select t_ok((select count(*) from public.icloud_outbox) = (select icloud from public.t_counts)
        and (select count(*) from public.google_tasks_outbox) = (select google from public.t_counts),
  'Q1 a change of details alone (C3, O2) queues nothing for Apple Calendar or Google Tasks');
do $$
declare t uuid; n_i bigint; n_g bigint;
begin
  insert into public.tasks (user_id, title, status, google_sync_enabled, google_task_id) values
    ('00000000-0000-0000-0000-000000000001', 'On Google Tasks', 'open', true, 'gt-details-1') returning id into t;
  select count(*) into n_g from public.google_tasks_outbox;
  select count(*) into n_i from public.icloud_outbox;
  update public.tasks set details = '{"category":"media","type":"movie","with":["Ola"]}' where id = t;
  perform t_ok((select count(*) from public.google_tasks_outbox) = n_g and (select count(*) from public.icloud_outbox) = n_i,
    'Q2 a task on Google Tasks: its details change sends nothing to Google (not a field Google shows)');
end $$;

-- ═══ U. Delete and Undo ══════════════════════════════════════════════════════
set role authenticated;
do $$
declare snap jsonb; back jsonb;
begin
  snap := public.app_delete_rows('tasks', array[public.t_id('game')::text]);
  perform t_ok(not exists (select 1 from public.tasks where id = public.t_id('game')), 'U1 the plan deleted (one delete flow)');
  back := public.app_restore_rows(snap);
  perform t_ok(public.t_details(public.t_id('game')) = '{"category":"games","on":"RP6","with":["Kari"]}'
      and (select game_id from public.tasks where id = public.t_id('game')) = '50000000-0000-0000-0000-0000000000d1',
    'U2 …and its Undo brings the details back with the task and its link');
end $$;
do $$
declare p jsonb; tx bigint := (select x.tx from public.t_keep x where x.k = 'cinema-edit');
begin
  p := public.app_undo_transaction(tx);
  perform t_ok(p ->> 'error' is null and p ->> 'confirm' is not null, 'U3 Activity: the edit that changed the details can be taken back');
  p := public.app_undo_transaction(tx, true, p ->> 'confirm');
  perform t_ok(p ->> 'error' is null and public.t_details(public.t_id('cinema')) ->> 'seats' = 'H12–H13'
      and public.t_details(public.t_id('cinema')) ->> 'booking' = 'AB12CD',
    'U4 …and Undo this save puts the details back as they were before it');
end $$;
reset role;
