-- The app's events in Apple Calendar (171–177) across features (30.10.2026): the iCloud queue on top of the REAL
-- item save, repeat days, training rules, Google Calendar outbox, delete with Undo (135–169), as the live database
-- has them — what verify-db-icloud-events' stand-ins can't show. Setup runs as the superuser (the service role),
-- app writes as `authenticated`. Built by scripts/verify-db-icloud-cross.mjs.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_q(p_id uuid) returns table(n bigint, changed timestamptz, requested timestamptz, area text)
language sql security definer set search_path = '' as $$
  select count(*) over (), o.changed_at, o.requested_at, o.area from public.icloud_outbox o where o.entity_id = p_id
$$;
grant execute on function public.t_q(uuid) to authenticated;

-- Football and Training on Apple Calendar; the rest on Google.
insert into public.calendar_prefs (user_id, prefs) values ('00000000-0000-0000-0000-000000000001',
  '{"areas": {"football": {"app": "apple", "enabled": true}, "training": {"app": "apple", "enabled": true},
              "work": {"app": "google", "enabled": true}, "personal": {"app": "google", "enabled": true}, "media": {"app": "google", "enabled": true}}}');
select public.t_ok(public.icloud_writes_on('00000000-0000-0000-0000-000000000001'), 'setup: two areas on Apple');

-- X1. A football match saved through the real item save reaches the Apple queue as the app's own change.
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_save_item('{"title": "Lyn – Vålerenga", "domain": "personal", "priority": "medium", "category": "football",
    "date": "2026-11-12", "time": "19:00", "durationMinutes": 120, "google": "calendar", "today": "2026-10-30"}');
  insert into public.t_keep values ('match', r);
end $$;
reset role;
select public.t_ok((select count(*) = 1 and bool_and(changed is not null and changed = requested)
                    from public.t_q(((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid)),
  'X1: a match saved through app_save_item is queued once for Apple, as the app''s own change');
select public.t_ok((select category = 'football' from public.time_blocks where id = ((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid),
  'X1: …its slot is in the football area');

-- The drain put it in Apple Calendar (its own write never queues).
delete from public.icloud_outbox;
update public.time_blocks set icloud_area = 'football', icloud_etag = '"v1"' where id = ((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid;
select public.t_ok(not exists (select 1 from public.icloud_outbox), 'X1: the drain''s own write of icloud_area/etag queues nothing');

-- X2. Ticking it done (the real task row) re-queues the slot as the app's own change.
set role authenticated;
update public.tasks set status = 'done' where id = ((select v from public.t_keep where k = 'match') ->> 'taskId')::uuid;
reset role;
select public.t_ok((select count(*) = 1 and bool_and(changed is not null) from public.t_q(((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid)),
  'X2: ticking the match done queues its Apple event (the ✓ in the title)');
delete from public.icloud_outbox;
set role authenticated;
update public.tasks set status = 'open' where id = ((select v from public.t_keep where k = 'match') ->> 'taskId')::uuid;
reset role;
delete from public.icloud_outbox;

-- X3. A settings change re-sends it as a re-send; an iPhone move from before still wins over that.
update public.calendar_prefs set prefs = prefs || '{"notes": "link"}' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select count(*) = 1 and bool_and(changed is null) from public.t_q(((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid)),
  'X3: a notes change re-queues the match as a re-send, not as a change of the item');
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', ((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid,
  'football', jsonb_build_object('date', '2026-11-13', 'time', '18:00', 'minutes', 120, 'lastModified', (now() - interval '1 minute')::text), '"v2"') = 'moved',
  'X3: an iPhone move made before the settings change is taken through the real slot rules');
select public.t_ok((select t.due_date = '2026-11-13' from public.tasks t where t.id = ((select v from public.t_keep where k = 'match') ->> 'taskId')::uuid),
  'X3: …and the task''s due day follows the moved slot (the real item rules)');
delete from public.icloud_outbox;

-- X4. Delete with Undo (the real 144): the delete queues the Apple removal; Undo with the browser's reset puts it back
--     without its old Apple link, and queues it to be put in Apple again.
set role authenticated;
do $$
declare s jsonb;
begin
  s := public.app_delete_rows('tasks', array[(select v from public.t_keep where k = 'match') ->> 'taskId']);
  insert into public.t_keep values ('deleted', s);
end $$;
reset role;
select public.t_ok((select count(*) = 1 and bool_and(area = 'football') from public.t_q(((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid)),
  'X4: deleting the match queues its Apple event''s removal, with the calendar it is in');
delete from public.icloud_outbox;
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_restore_rows((select v from public.t_keep where k = 'deleted'),
    '{"tasks": {"google_task_id": null, "google_etag": null, "google_hidden": false, "google_deleted": false},
      "time_blocks": {"google_calendar_event_id": null, "icloud_area": null, "icloud_etag": null}}');
  insert into public.t_keep values ('restored', r);
end $$;
reset role;
select public.t_ok((select icloud_area is null and icloud_etag is null from public.time_blocks where id = ((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid),
  'X4: Undo puts the match back without its old Apple link');
select public.t_ok((select count(*) = 1 and bool_and(changed is not null) from public.t_q(((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid)),
  'X4: …and queues it to be put in Apple Calendar again');
delete from public.icloud_outbox;

-- X5. The hand-over to the real Google Calendar outbox (135): only the item's own event id is handed over.
update public.time_blocks set icloud_area = 'football', google_calendar_event_id = replace(id::text, '-', '')
 where id = ((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid;
delete from public.icloud_outbox;
select public.t_ok(public.icloud_hand_over('00000000-0000-0000-0000-000000000001', 'slot', ((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid,
  replace((select v from public.t_keep where k = 'match') ->> 'blockId', '-', '')) = 'handed', 'X5: the hand-over works on the real calendar outbox');
select public.t_ok((select count(*) = 1 and bool_and(operation = 'delete') from public.calendar_outbox
                    where event_id = replace((select v from public.t_keep where k = 'match') ->> 'blockId', '-', '')),
  'X5: …one Google delete is queued for the item''s own event');

-- X6. A repeating training plan saved through the real item save reaches the queue; a day split off it (the real 155/156)
--     queues the day and the plan (its series leaves the day out).
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_save_item('{"title": "Lower B", "domain": "personal", "priority": "medium", "category": "training",
    "date": "2026-11-02", "time": "07:00", "durationMinutes": 60, "google": "calendar", "today": "2026-10-30",
    "repeat": {"kind": "weekly", "daysOfWeek": [1]}}');
  insert into public.t_keep values ('plan', r);
end $$;
reset role;
create temp table t_plan as
  select id from public.schedule_blocks where user_id = '00000000-0000-0000-0000-000000000001' and title = 'Lower B';
grant select on t_plan to authenticated;
select public.t_ok((select count(*) = 1 from t_plan), 'X6: the save made one repeating plan: ' || (select v::text from public.t_keep where k = 'plan'));
select public.t_ok((select count(*) >= 1 and bool_and(changed is not null) from public.t_q((select id from t_plan))),
  'X6: the training plan is queued for Apple as one series, as the app''s own change');
delete from public.icloud_outbox;
update public.schedule_blocks set icloud_area = 'training', icloud_from = '2026-11-02' where id = (select id from t_plan);
select public.t_ok(not exists (select 1 from public.icloud_outbox), 'X6: the drain''s own write on the plan queues nothing');
-- X7. One day of it becomes its own item (the real 156 item_occurrence, as the day popup does).
set role authenticated;
select public.item_occurrence((select id from t_plan), '2026-11-09', '2026-10-30');
reset role;
select public.t_ok(exists (select 1 from public.icloud_outbox o join public.time_blocks b on b.id = o.entity_id
                           where b.schedule_block_id = (select id from t_plan) and b.date = '2026-11-09' and o.changed_at is not null),
  'X7: a day split off the training plan is queued for Apple as its own event');
select public.t_ok(exists (select 1 from public.icloud_outbox where entity_id = (select id from t_plan))
                   and (select '2026-11-09'::date = any (except_dates) from public.schedule_blocks where id = (select id from t_plan)),
  'X7: …and the plan is sent again without that day (no day twice in Apple Calendar)');
-- X8. The real 167 rule: a training day moved 7+ days reaches Apple too (its writes are queued like any change).
delete from public.icloud_outbox;
set role authenticated;
update public.time_blocks set date = '2026-11-20' where schedule_block_id = (select id from t_plan) and date = '2026-11-09';
reset role;
select public.t_ok(exists (select 1 from public.icloud_outbox o join public.time_blocks b on b.id = o.entity_id
                           where b.schedule_block_id = (select id from t_plan) and o.changed_at is not null),
  'X8: moving that training day (and whatever the training rules change with it) is queued for Apple');
-- X9. Settings: the first save after 177 (no new keys) re-sends nothing, with the real chain.
delete from public.icloud_outbox;
update public.calendar_prefs set prefs = (prefs - 'notes' - 'allDayAlert') where user_id = '00000000-0000-0000-0000-000000000001';
delete from public.icloud_outbox;
update public.calendar_prefs set prefs = prefs || '{"notes": "notes+link", "allDayAlert": null}' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok(not exists (select 1 from public.icloud_outbox), 'X9: saving the defaults over a pre-177 row re-sends nothing');
-- X10. Switching Football back to Google re-queues its Apple events as re-sends (to be removed once Google has them).
update public.calendar_prefs set prefs = jsonb_set(prefs, '{areas,football,app}', '"google"') where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select count(*) >= 1 and bool_and(changed is null) from public.t_q(((select v from public.t_keep where k = 'match') ->> 'blockId')::uuid)),
  'X10: an area switched back to Google re-queues its Apple events as re-sends (an iPhone edit from before still counts)');
-- X11. A training session moved 9 days on the iPhone: 167/169's rule runs, and ITS writes are queued for Apple.
create or replace function public.t_d(n integer) returns date language sql stable as $$ select (now() at time zone 'Europe/Oslo')::date + n $$;
insert into public.hevy_routines (id, user_id, title) values ('x-lower', '00000000-0000-0000-0000-000000000001', 'Lower C');
insert into public.tasks (id, user_id, title, domain, section, status, priority, due_date, due_time, source_type, hevy_routine_id, google_target) values
  ('00000000-0000-4000-8000-0000000b0101', '00000000-0000-0000-0000-000000000001', 'Lower C', 'personal', 'backlog', 'open', 'medium', public.t_d(1), '17:00', 'training_session', 'x-lower', 'calendar'),
  ('00000000-0000-4000-8000-0000000b0102', '00000000-0000-0000-0000-000000000001', 'Lower C', 'personal', 'backlog', 'open', 'medium', public.t_d(8), '17:00', 'training_session', 'x-lower', 'calendar');
insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, category, task_id, source_type, icloud_area, icloud_etag) values
  ('00000000-0000-4000-8000-0000000c0101', '00000000-0000-0000-0000-000000000001', public.t_d(1), 'Lower C', '17:00', 60, 'training', '00000000-0000-4000-8000-0000000b0101', 'training_session', 'training', '"a1"'),
  ('00000000-0000-4000-8000-0000000c0102', '00000000-0000-0000-0000-000000000001', public.t_d(8), 'Lower C', '17:00', 60, 'training', '00000000-0000-4000-8000-0000000b0102', 'training_session', 'training', '"a2"');
delete from public.icloud_outbox;
select public.t_ok(public.apply_icloud_readback('00000000-0000-0000-0000-000000000001', 'slot', '00000000-0000-4000-8000-0000000c0101', 'training',
  jsonb_build_object('date', public.t_d(10)::text, 'time', '17:00', 'minutes', 60, 'foreign', true), '"a1-moved"') = 'moved',
  'X11: the iPhone''s 9-day move of a training session is applied');
select public.t_ok((select status = 'cancelled' from public.tasks where id = '00000000-0000-4000-8000-0000000b0101')
                   and (select date from public.time_blocks where id = '00000000-0000-4000-8000-0000000c0101') = public.t_d(1)
                   and (select date from public.time_blocks where id = '00000000-0000-4000-8000-0000000c0102') = public.t_d(10),
  'X11: the training rule ran (skipped back on its first day, next week''s session on the new day)');
select public.t_ok((select count(*) = 2 and bool_and(changed_at is not null) from public.icloud_outbox
                    where entity_id in ('00000000-0000-4000-8000-0000000c0101', '00000000-0000-4000-8000-0000000c0102')),
  'X11: both sessions are queued for Apple with their final days (the rule''s own writes are sent, as they are to Google)');
