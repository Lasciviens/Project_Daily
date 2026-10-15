-- Migration 155 (one item): first what 155 itself did to the owner's data
-- (nothing: no row lost, duplicated, moved or queued; every Google id, event
-- and series id, series start day, horizon and zone as they were), then the
-- item save, one day of a repeat, "Convert old items" and its own Undo (and
-- that Developer → Activity's Undo can't take a conversion back through the
-- cascade), the calendar outbox's upsert, and the Calendar read-back. Setup
-- and checks run as the superuser; every save runs as `authenticated` under
-- row level security and the owner lock, like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb, tx bigint);
grant all on public.t_keep to authenticated;
create or replace function public.t_v(p_k text) returns jsonb language sql stable as $$ select v from public.t_keep where k = p_k $$;
grant execute on function public.t_v(text) to authenticated;
-- a call that must be refused: its SQLSTATE (null = it ran)
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_err(text) to authenticated;
grant select on public.calendar_outbox to authenticated;

-- ═══ 0. Migration 155 itself ═══════════════════════════════════════════════
select public.t_ok((select count(*) from public.tasks) = (select count(*) from public.snap_tasks)
  and (select count(*) from public.time_blocks) = (select count(*) from public.snap_blocks)
  and (select count(*) from public.schedule_blocks) = (select count(*) from public.snap_plans),
  '155: no task, slot or plan lost or added');
select public.t_ok(not exists (
  select 1 from public.snap_tasks s full join public.tasks t on t.id = s.id
   where (s.id, s.user_id, s.title, s.status, s.section, s.due_date, s.due_time, s.start_date, s.google_task_id, s.google_sync_enabled,
          s.google_tasklist_id, s.google_etag, s.google_position, s.google_calendar_event_id, s.source_type, s.source_id)
     is distinct from
         (t.id, t.user_id, t.title, t.status, t.section, t.due_date, t.due_time, t.start_date, t.google_task_id, t.google_sync_enabled,
          t.google_tasklist_id, t.google_etag, t.google_position, t.google_calendar_event_id, t.source_type, t.source_id)),
  '155: every task keeps its Google Task id, list, sync switch, day, section and status');
select public.t_ok(not exists (
  select 1 from public.snap_blocks s full join public.time_blocks b on b.id = s.id
   where (s.id, s.user_id, s.task_id, s.date, s.start_time, s.duration_minutes, s.title, s.google_calendar_event_id,
          s.schedule_block_id, s.occurrence_date, s.source_type, s.source_id)
     is distinct from
         (b.id, b.user_id, b.task_id, b.date, b.start_time, b.duration_minutes, b.title, b.google_calendar_event_id,
          b.schedule_block_id, b.occurrence_date, b.source_type, b.source_id)),
  '155: every slot keeps its event id, day, time, length, task and plan day');
select public.t_ok(not exists (
  select 1 from public.snap_plans s full join public.schedule_blocks p on p.id = s.id
   where (s.id, s.user_id, s.title, s.days_of_week, s.start_time, s.end_time, s.effective_from, s.except_dates, s.repeat_kind,
          s.google_calendar_event_id, s.google_calendar_horizon, s.google_calendar_time_zone, s.google_calendar_from)
     is distinct from
         (p.id, p.user_id, p.title, p.days_of_week, p.start_time, p.end_time, p.effective_from, p.except_dates, p.repeat_kind,
          p.google_calendar_event_id, p.google_calendar_horizon, p.google_calendar_time_zone, p.google_calendar_from)),
  '155: every plan keeps its series id, start day (google_calendar_from), horizon, zone, rule and days taken out');
select public.t_ok((select count(*) from public.calendar_outbox) = (select calendar_rows from public.snap_counts)
  and (select count(*) from public.google_tasks_outbox) = (select tasks_rows from public.snap_counts)
  and exists (select 1 from public.calendar_outbox where event_id = 'evOld' and operation = 'delete'),
  '155: queued nothing for Google (both outboxes as they were, the waiting row untouched)');
select public.t_ok((select count(*) from public.audit_logs) = (select audit_rows from public.snap_counts),
  '155: wrote no row anywhere (the activity log has no change from it)');
select public.t_ok(not exists (select 1 from public.time_blocks where not busy)
  and not exists (select 1 from public.schedule_blocks where not busy or google_target is not null or domain is not null)
  and not exists (select 1 from public.tasks where google_target is not null),
  '155: old rows keep today''s behaviour (busy, no Google target)');
select public.t_ok((select is_nullable from information_schema.columns where table_name = 'schedule_blocks' and column_name = 'start_time') = 'YES'
  and public.t_err($$insert into public.schedule_blocks (user_id, title, days_of_week, start_time, end_time) values
     ('00000000-0000-0000-0000-000000000001', 'x', '{1}', '10:00', null)$$) = '23514',
  'a repeat may have no time, but never a start without an end');

-- ═══ 1. The item save ═══════════════════════════════════════════════════════
set role authenticated;
do $$
declare r jsonb; t record;
begin
  r := public.app_save_item('{"title":"Buy milk","domain":"personal","priority":"medium","date":null,"time":null,
    "durationMinutes":null,"google":"tasks","today":"2026-10-15"}');
  insert into public.t_keep values ('milk', r, txid_current());
  select * into t from public.tasks where id = (r ->> 'taskId')::uuid;
  perform public.t_ok(t.section = 'inbox' and t.due_date is null and t.google_target = 'tasks' and t.google_sync_enabled
    and (r ->> 'created')::boolean and r ->> 'blockId' is null,
    'save: no day, Google Tasks → an Inbox task on Google Tasks, no slot');
  perform public.t_ok(exists (select 1 from public.google_tasks_outbox o where o.task_id = t.id and o.operation = 'create'),
    'save: the Google Tasks outbox creates it');
end $$;

do $$
declare r jsonb; t record; b record;
begin
  r := public.app_save_item('{"title":"Call bank","domain":"personal","priority":"high","date":"2026-10-15","time":"14:00",
    "durationMinutes":null,"google":"calendar","today":"2026-10-15"}');
  insert into public.t_keep values ('bank', r, txid_current());
  select * into t from public.tasks where id = (r ->> 'taskId')::uuid;
  select * into b from public.time_blocks where id = (r ->> 'blockId')::uuid;
  perform public.t_ok(t.section = 'today' and t.due_date = '2026-10-15' and t.due_time = '14:00' and t.google_target = 'calendar'
    and not t.google_sync_enabled and t.priority = 'high',
    'save: today 14:00, Google Calendar → a Today task, off Google Tasks');
  perform public.t_ok(b.task_id = t.id and b.start_time = '14:00' and not b.busy and b.duration_minutes = 15 and b.google_calendar_event_id is null,
    'save: a time with no length → a slot that blocks no time (busy false, nominal 15 minutes)');
  perform public.t_ok(not exists (select 1 from public.google_tasks_outbox o where o.task_id = t.id)
    and not exists (select 1 from public.calendar_outbox c where c.time_block_id = b.id),
    'save: nothing queued for Google (the browser links the event)');
end $$;

do $$
declare r jsonb; b record;
begin
  r := public.app_save_item('{"title":"Water plants","domain":"personal","priority":"low","date":"2026-10-18","time":null,
    "durationMinutes":null,"google":"calendar","today":"2026-10-15"}');
  insert into public.t_keep values ('plants1', r, txid_current());
  select * into b from public.time_blocks where id = (r ->> 'blockId')::uuid;
  perform public.t_ok(b.start_time is null and not b.busy and b.date = '2026-10-18'
    and (select section from public.tasks where id = (r ->> 'taskId')::uuid) = 'backlog',
    'save: a day, no time, "Show on Calendar" → an all-day presence slot; another day → Backlog');
  r := public.app_save_item('{"title":"Gym","domain":"personal","priority":"medium","date":"2026-10-16","time":"17:30",
    "durationMinutes":60,"google":"none","today":"2026-10-15"}');
  select * into b from public.time_blocks where id = (r ->> 'blockId')::uuid;
  perform public.t_ok(b.busy and b.duration_minutes = 60 and b.start_time = '17:30',
    'save: a time with a length → a busy slot');
  r := public.app_save_item('{"title":"Report","domain":"work","priority":"medium","date":"2026-10-16","time":null,
    "durationMinutes":null,"deadline":{"date":"2026-10-20","time":"12:00"},"google":"tasks","today":"2026-10-15"}');
  insert into public.t_keep values ('report', r, txid_current());
  select * into b from public.time_blocks where id = (r ->> 'blockId')::uuid;
  perform public.t_ok((select due_date = '2026-10-20' and due_time = '12:00' and section = 'backlog'
                         from public.tasks where id = (r ->> 'taskId')::uuid)
    and b.date = '2026-10-16' and b.start_time is null and not b.busy,
    'save: "+ Deadline" is the task''s due; a slot holds the item''s own day (Daily never shows the deadline as a do-time)');
  r := public.app_save_item('{"title":"Someday","domain":"personal","priority":"medium","date":null,"time":null,
    "durationMinutes":null,"deadline":{"date":"2026-10-25","time":null},"google":"none","today":"2026-10-15"}');
  perform public.t_ok((select due_date = '2026-10-25' and section = 'inbox' from public.tasks where id = (r ->> 'taskId')::uuid)
    and r ->> 'blockId' is null,
    'save: a deadline with no day still shows on its day (due_date), in the Inbox, no slot');
  r := public.app_save_item('{"title":"Gym","domain":"personal","priority":"medium","date":"2026-10-17","time":"17:30","durationMinutes":60,
    "deadline":{"date":"2026-10-20","time":null},"google":"none","source":{"type":"training_session","id":null},"category":"training","today":"2026-10-15"}');
  perform public.t_ok((select due_date = '2026-10-17' and due_time = '17:30' and source_type = 'training_session'
                         from public.tasks where id = (r ->> 'taskId')::uuid)
    and (select category from public.time_blocks where id = (r ->> 'blockId')::uuid) = 'training',
    'save: a training session never gets a deadline (its day and time are one fact with its slot, 142)');
  r := public.app_save_item('{"title":"S02E05","domain":"media","priority":"medium","date":"2026-10-17","time":"21:00","durationMinutes":50,
    "google":"none","source":{"type":"tv_series","id":"00000000-0000-4000-8000-0000000000aa"},"category":"media","color":"purple",
    "startDate":"2026-10-16","blockSource":{"type":"tv_episode","id":"00000000-0000-4000-8000-0000000000aa","seasonNumber":2,"episodeNumber":5},
    "today":"2026-10-15"}');
  perform public.t_ok((select source_type = 'tv_series' and start_date = '2026-10-16' from public.tasks where id = (r ->> 'taskId')::uuid)
    and (select source_type = 'tv_episode' and season_number = 2 and episode_number = 5 and color = 'purple' and category = 'media'
           from public.time_blocks where id = (r ->> 'blockId')::uuid),
    'save: the sheet''s extras — the slot''s own source with its episode, its look, the task''s window start');
end $$;

do $$
declare r jsonb; k jsonb := public.t_v('report');
begin
  -- the deadline goes: the presence slot that only held the day can go too (no event on it)
  r := public.app_save_item(jsonb_build_object('taskId', k ->> 'taskId', 'title', 'Report', 'domain', 'work', 'priority', 'medium',
    'date', '2026-10-16', 'time', null, 'durationMinutes', null, 'deadline', null, 'google', 'tasks', 'today', '2026-10-15'));
  perform public.t_ok(r ->> 'blockId' is null and not exists (select 1 from public.time_blocks where task_id = (k ->> 'taskId')::uuid)
    and (select due_date = '2026-10-16' and due_time is null from public.tasks where id = (k ->> 'taskId')::uuid),
    'save: no deadline any more → the due is the day again and the day''s slot goes');
end $$;

select public.t_ok(public.t_err($$select public.app_save_item('{"title":"x","domain":"personal","priority":"low","date":null,"time":"10:00","google":"none"}')$$) = 'IT003',
  'save refuses a time with no day');
select public.t_ok(public.t_err($$select public.app_save_item('{"title":"x","domain":"personal","priority":"low","date":null,"time":null,"google":"calendar"}')$$) = 'IT003',
  'save refuses Google Calendar with no day');
select public.t_ok(public.t_err($$select public.app_save_item('{"title":"x","domain":"personal","priority":"low","date":"2026-10-15","time":null,"google":"tasks",
  "repeat":{"kind":"weekly","daysOfWeek":[1],"startsOn":"2026-10-15"}}')$$) = 'IT002',
  'save refuses Google Tasks for a repeat (Tasks can''t repeat through its API)');
select public.t_ok(public.t_err($$select public.app_save_item('{"title":"  ","domain":"personal","priority":"low","google":"none"}')$$) = 'IT001',
  'save refuses an empty title');
select public.t_ok(public.t_err($$select public.app_save_item('{"title":"x","domain":"personal","priority":"low","date":"2026-10-15","time":"10:00","durationMinutes":2000,"google":"none"}')$$) = 'IT005',
  'save refuses a length over 24 hours');

-- Moving between Google Tasks and Calendar: create the new copy, confirm, then remove the old one
do $$
declare r jsonb; t record; n_before integer;
begin
  n_before := (select count(*) from public.google_tasks_outbox where task_id = '00000000-0000-4000-8000-00000000000a');
  r := public.app_save_item('{"taskId":"00000000-0000-4000-8000-00000000000a","title":"Pay rent","domain":"personal","priority":"medium",
    "date":"2026-10-15","time":"16:00","durationMinutes":30,"google":"calendar","today":"2026-10-15"}');
  select * into t from public.tasks where id = '00000000-0000-4000-8000-00000000000a';
  perform public.t_ok(t.google_sync_enabled and t.google_task_id = 'gt-A' and t.google_target = 'calendar'
    and not exists (select 1 from public.google_tasks_outbox o where o.task_id = t.id and o.operation = 'delete'),
    'Tasks → Calendar: the Google Task stays until Calendar is confirmed (no delete queued, id kept)');
  perform public.t_ok((select count(*) from public.time_blocks where task_id = t.id) = 1 and (r ->> 'googleSyncWas')::boolean,
    'Tasks → Calendar: the slot is made, and the answer says Google Tasks was on');
  -- the browser confirmed the event: it turns Google Tasks off (the old copy goes)
  update public.tasks set google_sync_enabled = false where id = t.id;
  perform public.t_ok(exists (select 1 from public.google_tasks_outbox o where o.task_id = t.id and o.operation = 'delete'),
    'Tasks → Calendar: only then the old Google Task is queued for removal');
end $$;

reset role;
update public.time_blocks set google_calendar_event_id = 'evPlants'
 where id = ((select v from public.t_keep where k = 'plants1') ->> 'blockId')::uuid;
set role authenticated;
do $$
declare r jsonb; k jsonb := public.t_v('plants1'); v_block uuid;
begin
  v_block := (k ->> 'blockId')::uuid;
  r := public.app_save_item(jsonb_build_object('taskId', k ->> 'taskId', 'title', 'Water plants', 'domain', 'personal', 'priority', 'low',
    'date', '2026-10-18', 'time', null, 'durationMinutes', null, 'google', 'tasks', 'today', '2026-10-15'));
  perform public.t_ok((r ->> 'blockToDrop')::uuid = v_block and exists (select 1 from public.time_blocks where id = v_block and google_calendar_event_id = 'evPlants')
    and (select google_sync_enabled from public.tasks where id = (k ->> 'taskId')::uuid)
    and exists (select 1 from public.google_tasks_outbox o where o.task_id = (k ->> 'taskId')::uuid and o.operation = 'create'),
    'Calendar → Tasks: the Google Task is created; the all-day slot and its event stay (blockToDrop) until the browser confirms');
  perform public.t_ok(not public.app_item_drop_block(v_block) and exists (select 1 from public.time_blocks where id = v_block),
    'Calendar → Tasks: the slot can''t be dropped while it still has its event');
end $$;
reset role;
update public.time_blocks set google_calendar_event_id = null where id = ((select v from public.t_keep where k = 'plants1') ->> 'blockId')::uuid;
set role authenticated;
select public.t_ok(public.app_item_drop_block(((select v from public.t_keep where k = 'plants1') ->> 'blockId')::uuid),
  'Calendar → Tasks: once its event is gone, the presence slot goes; the task stays');

do $$
declare r jsonb; d integer;
begin
  d := (select count(*) from public.google_tasks_outbox where task_id = '00000000-0000-4000-8000-00000000000d' and operation = 'delete');
  r := public.app_save_item('{"taskId":"00000000-0000-4000-8000-00000000000d","title":"Book hytte","domain":"personal","priority":"medium",
    "date":"2026-11-30","time":null,"durationMinutes":null,"google":"none","today":"2026-10-15"}');
  perform public.t_ok((select not google_sync_enabled and google_target = 'none' and start_date = '2026-11-01' from public.tasks where id = '00000000-0000-4000-8000-00000000000d')
    and (select count(*) from public.google_tasks_outbox where task_id = '00000000-0000-4000-8000-00000000000d' and operation = 'delete') = d + 1,
    '"Not on Google": the Google Task is queued for removal; the window (start_date) is left as it was');
end $$;

do $$
declare r jsonb;
begin
  -- an old task saved again keeps its Google Task: its presence is the answer, never a default
  r := public.app_save_item('{"taskId":"00000000-0000-4000-8000-0000000000b2","title":"Theirs!","domain":"personal","priority":"medium",
    "date":"2026-10-15","time":null,"google":"tasks","today":"2026-10-15"}');
  perform public.t_ok(false, 'another account''s task can be saved');
exception when others then
  perform public.t_ok(sqlstate = 'IT004', 'save never reaches another account''s task (row level security)');
end $$;

-- ═══ 2. Repeating items ═════════════════════════════════════════════════════
do $$
declare r jsonb; p record;
begin
  r := public.app_save_item('{"title":"Water plants","domain":"personal","priority":"low","date":"2026-10-18","time":null,
    "durationMinutes":null,"google":"calendar","repeat":{"kind":"weekly","daysOfWeek":[0],"startsOn":"2026-10-18"},"today":"2026-10-15"}');
  insert into public.t_keep values ('sunday', r, txid_current());
  select * into p from public.schedule_blocks where id = (r ->> 'scheduleBlockId')::uuid;
  perform public.t_ok(p.start_time is null and p.end_time is null and not p.busy and p.days_of_week = '{0}' and p.effective_from = '2026-10-18'
    and p.google_target = 'calendar' and p.priority = 'low' and p.domain = 'personal' and r ->> 'taskId' is null,
    'repeat with no time → a rule with no time (an all-day series), no task');
  r := public.app_save_item('{"title":"Gym","domain":"personal","priority":"medium","date":"2026-10-19","time":"17:30",
    "durationMinutes":null,"google":"none","repeat":{"kind":"interval","interval":1,"unit":"week","daysOfWeek":[1,3,5],"startsOn":"2026-10-19"},"today":"2026-10-15"}');
  select * into p from public.schedule_blocks where id = (r ->> 'scheduleBlockId')::uuid;
  perform public.t_ok(p.repeat_kind = 'weekly' and p.repeat_interval is null and p.start_time = '17:30' and p.end_time = '17:45' and not p.busy,
    'repeat: "every 1 week" is stored as weekly; a time with no length blocks no time (nominal end)');
  r := public.app_save_item('{"title":"Bins","domain":"personal","priority":"medium","date":"2026-10-20","time":"07:00",
    "durationMinutes":10,"google":"calendar","repeat":{"kind":"dates","dates":["2026-11-03","2026-10-20"],"startsOn":"2026-10-25"},"today":"2026-10-15"}');
  select * into p from public.schedule_blocks where id = (r ->> 'scheduleBlockId')::uuid;
  perform public.t_ok(p.repeat_kind = 'dates' and p.repeat_dates = '{2026-10-20,2026-11-03}' and p.effective_from = '2026-10-20' and p.busy,
    'repeat on picked dates starts at the earliest pick');
end $$;

-- One day of a repeat: done / skip / undo, a double tap, remove / restore
do $$
declare r jsonb; r2 jsonb; plan uuid := (public.t_v('sunday') ->> 'scheduleBlockId')::uuid; n integer;
begin
  r := public.app_repeat_day(plan, '2026-10-25', 'done', '2026-10-15');
  insert into public.t_keep values ('done25', r, txid_current());
  perform public.t_ok((r ->> 'created')::boolean and (select status from public.tasks where id = (r ->> 'taskId')::uuid) = 'done'
    and (select except_dates from public.schedule_blocks where id = plan) @> '{2026-10-25}'
    and (select occurrence_date = '2026-10-25' and schedule_block_id = plan and start_time is null from public.time_blocks where id = (r ->> 'blockId')::uuid),
    'repeat day done: the day becomes its own item (slot + task), the rule leaves it out, the task is done');
  perform public.t_ok((select google_target from public.tasks where id = (r ->> 'taskId')::uuid) = 'none'
    and (select priority from public.tasks where id = (r ->> 'taskId')::uuid) = 'low',
    'repeat day: the day''s item takes the rule''s priority and Google target (the rule has no series yet)');
  n := (select count(*) from public.time_blocks where schedule_block_id = plan);
  r2 := public.app_repeat_day(plan, '2026-10-25', 'done', '2026-10-15');
  perform public.t_ok(not (r2 ->> 'created')::boolean and not (r2 ->> 'changed')::boolean and r2 ->> 'taskId' = r ->> 'taskId'
    and (select count(*) from public.time_blocks where schedule_block_id = plan) = n
    and (select count(*) from public.tasks where id = (r ->> 'taskId')::uuid) = 1,
    'repeat day: a double tap makes nothing twice');
  r2 := public.app_repeat_day(plan, '2026-10-25', 'undo', '2026-10-15');
  perform public.t_ok((r2 ->> 'changed')::boolean and r2 ->> 'previousStatus' = 'done'
    and (select status from public.tasks where id = (r ->> 'taskId')::uuid) = 'open'
    and exists (select 1 from public.time_blocks where id = (r ->> 'blockId')::uuid),
    'repeat day undo: open again, the day stays its own item');
  r2 := public.app_repeat_day(plan, '2026-11-01', 'skip', '2026-10-15');
  perform public.t_ok((select status from public.tasks where id = (r2 ->> 'taskId')::uuid) = 'cancelled',
    'repeat day skip: that day is cancelled (kept, never deleted)');
  r2 := public.app_repeat_day(plan, '2026-11-08', 'remove', '2026-10-15');
  perform public.t_ok((r2 ->> 'changed')::boolean and (select except_dates from public.schedule_blocks where id = plan) @> '{2026-11-08}'
    and not exists (select 1 from public.time_blocks where schedule_block_id = plan and occurrence_date = '2026-11-08'),
    '"Only this day" with nothing split off: the day leaves the rule');
  r2 := public.app_repeat_day(plan, '2026-11-08', 'restore', '2026-10-15');
  perform public.t_ok((r2 ->> 'changed')::boolean and not (select except_dates from public.schedule_blocks where id = plan) @> '{2026-11-08}',
    'Undo "only this day": the day is back');
  r2 := public.app_repeat_day(plan, '2026-10-25', 'restore', '2026-10-15');
  perform public.t_ok(not (r2 ->> 'changed')::boolean and (select except_dates from public.schedule_blocks where id = plan) @> '{2026-10-25}',
    'restore never puts back a day that is its own item');
end $$;

-- A missed day stays missed: nothing in the save or the day actions moves a past day
select public.t_ok(not exists (select 1 from public.time_blocks b join public.tasks t on t.id = b.task_id
   where b.occurrence_date is not null and b.date <> b.occurrence_date and b.schedule_block_id = (public.t_v('sunday') ->> 'scheduleBlockId')::uuid),
  'a repeat''s day keeps its own day (never carried over)');

-- Edit one day of a repeat (scope day) and the whole rule (scope all)
do $$
declare plan uuid := (public.t_v('sunday') ->> 'scheduleBlockId')::uuid; r jsonb; b record;
begin
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', plan, 'scope', 'day', 'occurrenceDate', '2026-11-15',
    'title', 'Water plants (balcony)', 'domain', 'personal', 'priority', 'low', 'date', '2026-11-16', 'time', '08:00',
    'durationMinutes', 20, 'google', 'calendar', 'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(0), 'startsOn', '2026-10-18'),
    'today', '2026-10-15'));
  select * into b from public.time_blocks where id = (r ->> 'blockId')::uuid;
  perform public.t_ok((r ->> 'occurrence')::boolean and b.date = '2026-11-16' and b.start_time = '08:00' and b.busy and b.occurrence_date = '2026-11-15'
    and (select except_dates from public.schedule_blocks where id = plan) @> '{2026-11-15}'
    and (select title from public.schedule_blocks where id = plan) = 'Water plants',
    'edit this day only: that day moves (its own item), the rule and its other days stay');
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', plan, 'scope', 'all',
    'title', 'Water all plants', 'domain', 'personal', 'priority', 'medium', 'date', '2026-10-18', 'time', null,
    'durationMinutes', null, 'google', 'calendar', 'repeat', jsonb_build_object('kind', 'weekly', 'daysOfWeek', jsonb_build_array(0, 3), 'startsOn', '2026-10-18'),
    'today', '2026-10-15'));
  perform public.t_ok((select title = 'Water all plants' and days_of_week = '{0,3}' and except_dates @> '{2026-10-25,2026-11-15}'
                         from public.schedule_blocks where id = plan)
    and (select date from public.time_blocks where schedule_block_id = plan and occurrence_date = '2026-11-15') = '2026-11-16',
    'edit every day: the rule changes; days already split off keep their own edits');
end $$;

-- One-off ↔ repeat
do $$
declare r jsonb; k jsonb := public.t_v('bank'); v_plan uuid; v_task uuid;
begin
  r := public.app_save_item(jsonb_build_object('taskId', k ->> 'taskId', 'blockId', k ->> 'blockId', 'scope', 'all',
    'title', 'Call bank', 'domain', 'personal', 'priority', 'high', 'date', '2026-10-15', 'time', '14:00', 'durationMinutes', null,
    'google', 'calendar', 'repeat', jsonb_build_object('kind', 'monthly', 'daysOfWeek', jsonb_build_array(), 'startsOn', '2026-10-15'),
    'today', '2026-10-15'));
  v_plan := (r ->> 'scheduleBlockId')::uuid;
  perform public.t_ok(r ->> 'replacedTaskId' = k ->> 'taskId' and not exists (select 1 from public.tasks where id = (k ->> 'taskId')::uuid)
    and not exists (select 1 from public.time_blocks where id = (k ->> 'blockId')::uuid)
    and (select repeat_kind = 'monthly' and start_time = '14:00' from public.schedule_blocks where id = v_plan),
    'a one-off given a repeat becomes the rule (its task and slot go in the same save)');
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', v_plan, 'scope', 'all',
    'title', 'Call bank', 'domain', 'personal', 'priority', 'high', 'date', '2026-10-22', 'time', null, 'durationMinutes', null,
    'google', 'tasks', 'repeat', null, 'today', '2026-10-15'));
  v_task := (r ->> 'taskId')::uuid;
  perform public.t_ok(r ->> 'replacedScheduleBlockId' = v_plan::text and not exists (select 1 from public.schedule_blocks where id = v_plan)
    and r ->> 'replacedEventId' is null
    and (select due_date = '2026-10-22' and google_sync_enabled from public.tasks where id = v_task),
    'a repeat given "no repeat" becomes a one-off item (never silently: only when the save says so)');
end $$;

do $$
declare plan uuid := (public.t_v('sunday') ->> 'scheduleBlockId')::uuid; r jsonb; k jsonb;
begin
  -- a day's item saved without its repeat (the sheet only had the task and slot) never deletes the rule
  select jsonb_build_object('taskId', b.task_id, 'blockId', b.id) into k from public.time_blocks b where b.schedule_block_id = plan and b.occurrence_date = '2026-11-15';
  r := public.app_save_item(jsonb_build_object('taskId', k ->> 'taskId', 'blockId', k ->> 'blockId', 'scheduleBlockId', plan, 'scope', 'item',
    'title', 'Water plants (balcony)', 'domain', 'personal', 'priority', 'low', 'date', '2026-11-16', 'time', '08:30',
    'durationMinutes', 20, 'google', 'calendar', 'today', '2026-10-15'));
  perform public.t_ok(exists (select 1 from public.schedule_blocks where id = plan) and r ->> 'replacedScheduleBlockId' is null
    and (select start_time from public.time_blocks where id = (k ->> 'blockId')::uuid) = '08:30',
    'a day''s item saved with no repeat (scope item) edits that day; the rule is never deleted');
  r := public.app_save_item(jsonb_build_object('taskId', k ->> 'taskId', 'blockId', k ->> 'blockId', 'scheduleBlockId', plan, 'scope', 'all',
    'title', 'Water plants (balcony)', 'domain', 'personal', 'priority', 'low', 'date', '2026-11-16', 'time', '08:30',
    'durationMinutes', 20, 'google', 'calendar', 'today', '2026-10-15'));
  perform public.t_ok(exists (select 1 from public.schedule_blocks where id = plan) and r ->> 'replacedScheduleBlockId' is null,
    '…even saved with scope all: a save that names a task or slot never deletes the rule');
  r := public.app_save_item(jsonb_build_object('scheduleBlockId', plan, 'scope', 'day', 'occurrenceDate', '2026-11-22',
    'title', 'Water plants', 'domain', 'personal', 'priority', 'low', 'date', '2026-11-22', 'time', null,
    'durationMinutes', null, 'google', 'calendar', 'today', '2026-10-15'));
  perform public.t_ok((r ->> 'occurrence')::boolean and exists (select 1 from public.schedule_blocks where id = plan),
    'scope day with no repeat in the save: still that day only');
end $$;

-- An old standalone slot opened in the sheet gets its task, keeping its event
reset role;
do $$ begin
  insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, category, google_calendar_event_id)
  values ('00000000-0000-4000-8000-0000000005b1', '00000000-0000-0000-0000-000000000001', '2026-10-21', 'Haircut', '11:00', 30, 'other', 'evOldSlot');
end $$;
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.app_save_item('{"blockId":"00000000-0000-4000-8000-0000000005b1","title":"Haircut","domain":"personal","priority":"medium",
    "date":"2026-10-21","time":"11:30","durationMinutes":30,"google":"calendar","today":"2026-10-15"}');
  perform public.t_ok(r ->> 'blockId' = '00000000-0000-4000-8000-0000000005b1'
    and (select task_id = (r ->> 'taskId')::uuid and google_calendar_event_id = 'evOldSlot' and start_time = '11:30'
           from public.time_blocks where id = '00000000-0000-4000-8000-0000000005b1')
    and (select not google_sync_enabled from public.tasks where id = (r ->> 'taskId')::uuid),
    'an old slot saved as an item keeps its id and its event, and gets its task (off Google Tasks)');
end $$;

-- ═══ 3. Activity's Undo of an item save ═════════════════════════════════════
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction((select x.tx from public.t_keep x where x.k = 'milk'));
  perform public.t_ok(p ->> 'error' is null, 'Undo this save: a new item''s save can be taken back');
end $$;

-- ═══ 4. Convert old items ═══════════════════════════════════════════════════
do $$
declare p jsonb;
begin
  p := public.app_convert_preview('2026-10-15');
  insert into public.t_keep values ('preview', p, null);
  perform public.t_ok((p ->> 'futureStandaloneBlocks')::integer = 4 and (p ->> 'pastStandaloneBlocks')::integer = 1
    and (p ->> 'autoClearedEpisodes')::integer = 1 and jsonb_array_length(p -> 'examples') = 4
    and p -> 'examples' -> 0 ->> 'title' = 'Call mum',
    'convert preview: 4 future standalone slots (a planned episode left out), 1 past one, examples by day');
end $$;

reset role;
create table public.t_conv_before as
  select id, date, start_time, duration_minutes, title, google_calendar_event_id, source_type, source_id from public.time_blocks
   where user_id = '00000000-0000-0000-0000-000000000001';
-- the owner's own rows: under row level security that is all the checks below can see
create table public.t_conv_counts as
  select (select count(*) from public.calendar_outbox where user_id = '00000000-0000-0000-0000-000000000001') as cal,
         (select count(*) from public.google_tasks_outbox where user_id = '00000000-0000-0000-0000-000000000001') as gt;
grant select on public.t_conv_before, public.t_conv_counts to authenticated;
set role authenticated;

do $$
declare r jsonb; t record;
begin
  r := public.app_convert_apply('2026-10-15');
  insert into public.t_keep values ('convert', r, txid_current());
  perform public.t_ok((r ->> 'converted')::integer = 4, 'convert: one task per future standalone slot');
  perform public.t_ok(not exists (
      select 1 from public.t_conv_before s left join public.time_blocks b on b.id = s.id
       where b.id is null or (s.date, s.start_time, s.duration_minutes, s.title, s.google_calendar_event_id, s.source_type, s.source_id)
               is distinct from (b.date, b.start_time, b.duration_minutes, b.title, b.google_calendar_event_id, b.source_type, b.source_id)),
    'convert: every slot keeps its id, day, time, title and event');
  select * into t from public.tasks where id = (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a1');
  perform public.t_ok(t.google_target = 'calendar' and not t.google_sync_enabled and t.source_type = 'manual' and t.section = 'backlog' and t.due_time = '19:00',
    'convert: a slot with an event → its task lives on Calendar (that event stays the one Google entry)');
  perform public.t_ok((select google_target = 'none' and section = 'today' from public.tasks where id = (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a2')),
    'convert: a slot that was never on Google stays off Google');
  perform public.t_ok((select source_type = 'movie' and source_id = '00000000-0000-4000-8000-0000000000ab' from public.tasks
                         where id = (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a6'))
    and (select source_type from public.tasks where id = (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a5')) = 'calendar',
    'convert: the slot''s source carries over (movie, calendar; NULL → manual)');
  perform public.t_ok((select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a3') is null
    and (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a4') is null,
    'convert: a past slot and a planned episode are left as they are (no made-up status)');
  perform public.t_ok((select count(*) from public.calendar_outbox) = (select cal from public.t_conv_counts)
    and (select count(*) from public.google_tasks_outbox) = (select gt from public.t_conv_counts),
    'convert: nothing queued for Google');
end $$;

select public.t_ok((public.app_convert_preview('2026-10-15') ->> 'futureStandaloneBlocks')::integer = 0,
  'convert: run again, nothing is left to convert (no duplicates)');

-- Developer → Activity can't take the conversion back by deleting its tasks
do $$
declare p jsonb;
begin
  p := public.app_undo_transaction((select x.tx from public.t_keep x where x.k = 'convert'));
  perform public.t_ok(p -> 'error' ->> 'code' = 'IT020',
    'Undo this save on a conversion: refused (its tasks would take the original slots with them)');
end $$;
select public.t_ok(public.t_err(format('select public.app_undo_transaction(%s, true, %L)', (select tx from public.t_keep where k = 'convert'),
    (public.app_undo_transaction((select tx from public.t_keep where k = 'convert')) ->> 'confirm'))) is not null
  and (select count(*) from public.time_blocks where id in (select id from public.t_conv_before)) = (select count(*) from public.t_conv_before)
  and (select count(*) from public.tasks where id = any (select unnest(task_ids) from public.item_conversions where id = (public.t_v('convert') ->> 'conversionId')::uuid)) = 4,
  'Undo this save on a conversion: applying it is refused too — every slot and task still there');
select public.t_ok(public.t_err(format('delete from public.item_conversions where id = %L', public.t_v('convert') ->> 'conversionId')) = 'IT020',
  'a conversion''s record can''t be deleted');

-- The conversion's own Undo: unlink first, then delete only what it made
reset role;
update public.tasks set status = 'done' where id = (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a6');
set role authenticated;
do $$
declare r jsonb; conv uuid := (public.t_v('convert') ->> 'conversionId')::uuid;
begin
  r := public.app_convert_undo(conv);
  perform public.t_ok((r ->> 'undone')::integer = 3 and (r ->> 'kept')::integer = 1,
    'convert Undo: the 3 untouched tasks go, the one closed since stays');
  perform public.t_ok(not exists (
      select 1 from public.t_conv_before s left join public.time_blocks b on b.id = s.id
       where b.id is null or (s.date, s.start_time, s.duration_minutes, s.title, s.google_calendar_event_id)
               is distinct from (b.date, b.start_time, b.duration_minutes, b.title, b.google_calendar_event_id)),
    'convert Undo: every original slot is still there with its event (nothing cascaded)');
  perform public.t_ok((select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a1') is null
    and (select task_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000005a6') is not null,
    'convert Undo: the undone slots are standalone again; the kept one stays linked');
  perform public.t_ok((select count(*) from public.calendar_outbox) = (select cal from public.t_conv_counts),
    'convert Undo: no Calendar event queued for removal');
  r := public.app_convert_undo(conv);
  perform public.t_ok((r ->> 'already')::boolean, 'convert Undo twice: the second does nothing');
end $$;

-- ═══ 5. The calendar outbox's upsert ════════════════════════════════════════
reset role;
do $$
declare n integer;
begin
  -- a server-side writer (the assistant, a sync) moves a linked slot
  perform set_config('test.uid', 'none', true);
  update public.time_blocks set date = '2026-10-21' where id = '00000000-0000-4000-8000-0000000000b1';
  perform public.t_ok(exists (select 1 from public.calendar_outbox where event_id = 'evB' and operation = 'upsert'
                                and time_block_id = '00000000-0000-4000-8000-0000000000b1'),
    'upsert: a linked slot moved on the server queues its event');
end $$;
do $$
declare t0 timestamptz := (select requested_at from public.calendar_outbox where event_id = 'evB');
begin
  update public.time_blocks set title = 'Dentist (moved)' where id = '00000000-0000-4000-8000-0000000000b1';
  perform public.t_ok((select count(*) from public.calendar_outbox where event_id = 'evB') = 1
    and (select requested_at from public.calendar_outbox where event_id = 'evB') > t0,
    'upsert: asked again → one row, requested_at moves (a drain holding the old one won''t remove it)');
  update public.tasks set status = 'done' where id = '00000000-0000-4000-8000-0000000000e1';
  perform public.t_ok(exists (select 1 from public.calendar_outbox where event_id = 'evO1' and operation = 'upsert'),
    'upsert: a task ticked done queues its slot''s event (the "✓ ")');
  update public.schedule_blocks set title = 'Gym (Hevy)' where id = '00000000-0000-4000-8000-0000000000a1';
  perform public.t_ok(exists (select 1 from public.calendar_outbox where event_id = 'evP1' and operation = 'upsert' and payload ->> 'series' = 'true'),
    'upsert: a linked plan renamed queues its series');
  update public.time_blocks set google_calendar_event_id = 'evNew' where id = '00000000-0000-4000-8000-0000000000c1';
  perform public.t_ok(not exists (select 1 from public.calendar_outbox where event_id = 'evNew'),
    'upsert: a link made (the browser''s own call) queues nothing');
  delete from public.tasks where id = '00000000-0000-4000-8000-00000000000b';
  perform public.t_ok((select operation from public.calendar_outbox where event_id = 'evB') = 'delete',
    'upsert → delete: a slot deleted while its upsert waits is deleted on Google, never pushed');
  update public.time_blocks set google_calendar_event_id = null where id = '00000000-0000-4000-8000-0000000000c1';
end $$;

-- ═══ 6. The Calendar read-back ══════════════════════════════════════════════
do $$
declare r text; c0 bigint := (select count(*) from public.calendar_outbox); v_task uuid;
begin
  -- a one-off event moved and renamed in Google Calendar
  insert into public.tasks (id, user_id, title, section, due_date, due_time, google_target)
  values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'Lunch', 'backlog', '2026-10-22', '12:00', 'calendar');
  insert into public.time_blocks (id, user_id, date, title, start_time, duration_minutes, task_id, google_calendar_event_id, updated_at)
  values ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-0000-0000-000000000001', '2026-10-22', 'Lunch', '12:00', 60,
          '00000000-0000-4000-8000-0000000000d1', 'evLunch', '2026-10-15 08:00+00');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evLunch","status":"confirmed","title":"Lunch with Ola",
    "allDay":false,"date":"2026-10-23","time":"12:30:00","minutes":90,"busy":true,"updated":"2026-10-15T09:00:00Z"}');
  perform public.t_ok(r = 'moved' and (select date = '2026-10-23' and start_time = '12:30' and duration_minutes = 90 and title = 'Lunch with Ola'
                                         from public.time_blocks where id = '00000000-0000-4000-8000-0000000000d2')
    and (select due_date = '2026-10-23' and due_time = '12:30' and title = 'Lunch with Ola' from public.tasks where id = '00000000-0000-4000-8000-0000000000d1'),
    'read-back: a one-off moved and renamed in Google → the slot and its task follow');
  perform public.t_ok((select count(*) from public.calendar_outbox) = c0, 'read-back: nothing sent back to Google');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evLunch","status":"confirmed","title":"Old title",
    "allDay":false,"date":"2026-10-01","time":"08:00:00","minutes":60,"busy":true,"updated":"2026-10-14T09:00:00Z"}');
  perform public.t_ok(r = 'stale' and (select date from public.time_blocks where id = '00000000-0000-4000-8000-0000000000d2') = '2026-10-23',
    'read-back: a change older than the slot''s own is skipped (the app''s save wins)');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evLunch","status":"confirmed","title":"✓ Lunch with Ola",
    "allDay":false,"date":"2026-10-23","time":"12:30:00","minutes":90,"busy":true,"updated":"2026-10-16T09:00:00Z"}');
  perform public.t_ok(r = 'renamed', 'read-back: (the caller strips "✓ " — a raw one reads as a rename, see calendarEventRules)');
  update public.tasks set title = 'Lunch with Ola' where id = '00000000-0000-4000-8000-0000000000d1';
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evLunch","status":"cancelled"}');
  perform public.t_ok(r = 'unlinked' and (select google_calendar_event_id from public.time_blocks where id = '00000000-0000-4000-8000-0000000000d2') is null
    and (select google_target = 'none' and status = 'open' from public.tasks where id = '00000000-0000-4000-8000-0000000000d1'),
    'read-back: deleted in Google → the Calendar presence turns off, the item stays open (never deleted or cancelled)');
  -- an all-day presence deleted in Google: its slot goes, the item stays
  v_task := gen_random_uuid();
  insert into public.tasks (id, user_id, title, section, due_date, google_target, google_sync_enabled)
  values (v_task, '00000000-0000-0000-0000-000000000001', 'Pack', 'backlog', '2026-10-24', 'both', true);
  insert into public.time_blocks (user_id, date, title, start_time, task_id, busy, google_calendar_event_id)
  values ('00000000-0000-0000-0000-000000000001', '2026-10-24', 'Pack', null, v_task, false, 'evPack');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evPack","status":"cancelled"}');
  perform public.t_ok(r = 'unlinked' and not exists (select 1 from public.time_blocks where task_id = v_task)
    and (select google_target = 'tasks' and google_sync_enabled from public.tasks where id = v_task),
    'read-back: an all-day presence deleted → its slot goes; "both" becomes Google Tasks only');
end $$;

do $$
declare r text; v_block uuid; v_task uuid;
begin
  -- one day of a series moved in Google → that day becomes the plan's own one-off day (142)
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evP1_20261023T153000Z","seriesId":"evP1","status":"confirmed",
    "title":"Gym","allDay":false,"date":"2026-10-24","time":"10:00:00","minutes":60,"busy":true,"originalDate":"2026-10-23","updated":"2026-10-15T10:00:00Z"}');
  select id, task_id into v_block, v_task from public.time_blocks where schedule_block_id = '00000000-0000-4000-8000-0000000000a1' and occurrence_date = '2026-10-23';
  perform public.t_ok(r = 'day_moved' and v_task is not null
    and (select date = '2026-10-24' and start_time = '10:00' and google_calendar_event_id = 'evP1_20261023T153000Z' from public.time_blocks where id = v_block)
    and (select except_dates @> '{2026-10-23}' and google_calendar_event_id = 'evP1' from public.schedule_blocks where id = '00000000-0000-4000-8000-0000000000a1'),
    'read-back: one day of a series moved → that day is its own item holding the instance; the series stays linked');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evP1_20261028T153000Z","seriesId":"evP1","status":"cancelled",
    "originalDate":"2026-10-28"}');
  perform public.t_ok(r = 'day_off' and exists (select 1 from public.time_blocks b join public.tasks t on t.id = b.task_id
      where b.schedule_block_id = '00000000-0000-4000-8000-0000000000a1' and b.occurrence_date = '2026-10-28'
        and b.google_calendar_event_id is null and t.status = 'open' and t.google_target = 'none'),
    'read-back: one day of a series deleted in Google → that day stays (open, off Google), never cancelled');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evP1_20261020T153000Z","seriesId":"evP1","status":"cancelled",
    "originalDate":"2026-10-20"}');
  perform public.t_ok(r = 'ignored', 'read-back: a day the app already took out (its own EXDATE) is ignored');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"someone-elses","status":"confirmed","title":"Party","date":"2026-10-30"}');
  perform public.t_ok(r = 'not_ours', 'read-back: an event no slot or plan stores is left alone');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000002', '{"id":"evP2","status":"cancelled"}');
  perform public.t_ok(r = 'not_ours' and (select google_calendar_event_id from public.schedule_blocks where id = '00000000-0000-4000-8000-0000000000a2') = 'evP2',
    'read-back: another account''s run never touches the owner''s series');
  r := public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evP2","status":"cancelled"}');
  perform public.t_ok(r = 'unlinked' and (select google_calendar_event_id is null and google_calendar_horizon is null and google_calendar_from is null
                                             and google_calendar_time_zone = 'Europe/Oslo' from public.schedule_blocks where id = '00000000-0000-4000-8000-0000000000a2'),
    'read-back: a series deleted in Google → the plan''s link goes (its zone stays), the plan stays');
end $$;

set role authenticated;
select public.t_ok(public.t_err($$select public.apply_calendar_readback('00000000-0000-0000-0000-000000000001', '{"id":"evO1","status":"cancelled"}')$$) = '42501',
  'read-back: the browser can''t call it (service role only)');
select public.t_ok(public.t_err($$select sync_token from public.google_calendar_sync_state$$) = '42501'
  and public.t_err($$select last_run_at, last_error from public.google_calendar_sync_state$$) is null,
  'read-back state: the browser reads the run''s outcome, never the sync token');
reset role;

-- ═══ 7. Activity trail, account deletion, the owner lock ════════════════════
select public.t_ok(exists (select 1 from public.audit_logs where table_name = 'schedule_blocks' and operation = 'UPDATE'),
  'repeating plans are in the activity log now');
do $$
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-000000000002', true);
  insert into public.item_conversions (user_id) values ('00000000-0000-0000-0000-000000000002');
  perform set_config('test.uid', '', true);
  delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
  perform public.t_ok(not exists (select 1 from public.item_conversions where user_id = '00000000-0000-0000-0000-000000000002'),
    'deleting an account still works (its conversion records go with it)');
end $$;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000003';
select public.t_ok(public.t_err($$select public.app_save_item('{"title":"x","domain":"personal","priority":"low","google":"none","date":null,"time":null}')$$) is not null,
  'owner lock: an account outside app_allowed_users can''t save an item');
reset test.uid;
reset role;
