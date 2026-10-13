-- Scenarios for migration 146 (repeat kinds on schedule_blocks).
-- `ok` raises on a mismatch; `refused` runs a write that the CHECK must turn
-- down. The runner fails on the first exception.
create or replace function ok(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;

create or replace function refused(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when check_violation then
    raise notice 'ok  %', label;
    return;
  end;
  raise exception 'FAIL %: the write was accepted', label;
end $$;

-- R0 the old rows keep their meaning
select ok('R0 every old row is weekly', (select string_agg(distinct repeat_kind, ',') from schedule_blocks), 'weekly');
select ok('R0 old days are untouched', (select days_of_week::text from schedule_blocks where id='00000000-0000-4000-8000-000000000002'), '{1,4}');
select ok('R0 old except_dates are untouched', (select except_dates::text from schedule_blocks where id='00000000-0000-4000-8000-000000000002'), '{2026-10-12}');
select ok('R0 no interval, unit or dates on old rows',
  (select count(*)::text from schedule_blocks where repeat_interval is not null or repeat_unit is not null or repeat_dates is not null), '0');
select ok('R0 a weekly row with no day still saves (no new rule for old rows)',
  (select repeat_kind from schedule_blocks where id='00000000-0000-4000-8000-000000000003'), 'weekly');
select ok('R0 the re-run added nothing', (select count(*)::text from schedule_blocks), '3');
-- a writer that knows nothing of 146 still writes a weekly plan
insert into schedule_blocks (id, title, days_of_week, start_time, end_time) values
  ('00000000-0000-4000-8000-000000000010', 'Old writer', '{2}', '18:00', '19:00');
select ok('R0 a write without the new columns is weekly', (select repeat_kind from schedule_blocks where id='00000000-0000-4000-8000-000000000010'), 'weekly');

-- R1 monthly: one weekday or none
insert into schedule_blocks (title, days_of_week, start_time, end_time, effective_from, repeat_kind) values
  ('Haircut', '{6}', '10:00', '11:00', '2026-10-13', 'monthly'),
  ('Rent',    '{}',  '09:00', '09:15', '2026-10-31', 'monthly');
select ok('R1 monthly with a weekday and without one save', (select count(*)::text from schedule_blocks where repeat_kind='monthly'), '2');
select refused('R1 monthly with two weekdays is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind) values ('x', '{1,2}', '10:00', '11:00', 'monthly')$$);
select refused('R1 monthly with an interval is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval) values ('x', '{}', '10:00', '11:00', 'monthly', 2)$$);
select refused('R1 monthly with a weekday out of range is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind) values ('x', '{7}', '10:00', '11:00', 'monthly')$$);

-- R2 interval: every N days / weeks / months
insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values
  ('Water plants', '{}',    '08:00', '08:10', 'interval', 3, 'day'),
  ('Football',     '{2,4}', '19:00', '20:30', 'interval', 2, 'week'),
  ('Dentist',      '{5}',   '08:30', '09:15', 'interval', 6, 'month'),
  ('Bills',        '{}',    '09:00', '09:30', 'interval', 2, 'month');
select ok('R2 every 3 days / 2 weeks / 6 months / 2 months save', (select count(*)::text from schedule_blocks where repeat_kind='interval'), '4');
select refused('R2 every N with no N is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_unit) values ('x', '{}', '10:00', '11:00', 'interval', 'day')$$);
select refused('R2 every 0 days is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values ('x', '{}', '10:00', '11:00', 'interval', 0, 'day')$$);
select refused('R2 every 100 days is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values ('x', '{}', '10:00', '11:00', 'interval', 100, 'day')$$);
select refused('R2 every N with no unit is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval) values ('x', '{}', '10:00', '11:00', 'interval', 2)$$);
select refused('R2 an unknown unit is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values ('x', '{}', '10:00', '11:00', 'interval', 2, 'year')$$);
select refused('R2 every N weeks with no weekday is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values ('x', '{}', '10:00', '11:00', 'interval', 2, 'week')$$);
select refused('R2 every N days with weekdays is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values ('x', '{1}', '10:00', '11:00', 'interval', 2, 'day')$$);
select refused('R2 every N months with two weekdays is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_interval, repeat_unit) values ('x', '{1,3}', '10:00', '11:00', 'interval', 2, 'month')$$);

-- R3 picked dates
insert into schedule_blocks (title, days_of_week, start_time, end_time, effective_from, repeat_kind, repeat_dates) values
  ('Concerts', '{}', '20:00', '23:00', '2026-10-20', 'dates', '{2026-10-20,2026-11-14,2026-12-31}');
select ok('R3 picked dates save', (select cardinality(repeat_dates)::text from schedule_blocks where title='Concerts'), '3');
select refused('R3 no picked date is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_dates) values ('x', '{}', '10:00', '11:00', 'dates', '{}')$$);
select refused('R3 a missing date list is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind) values ('x', '{}', '10:00', '11:00', 'dates')$$);
select refused('R3 a NULL inside the dates is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_dates) values ('x', '{}', '10:00', '11:00', 'dates', array['2026-10-20'::date, null])$$);
select refused('R3 picked dates with weekdays are refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind, repeat_dates) values ('x', '{1}', '10:00', '11:00', 'dates', '{2026-10-20}')$$);

-- R4 weekly stays clean, unknown kinds are refused
select refused('R4 weekly with an interval is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_interval) values ('x', '{1}', '10:00', '11:00', 2)$$);
select refused('R4 weekly with picked dates is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_dates) values ('x', '{1}', '10:00', '11:00', '{2026-10-20}')$$);
select refused('R4 an unknown kind is refused',
  $$insert into schedule_blocks (title, days_of_week, start_time, end_time, repeat_kind) values ('x', '{1}', '10:00', '11:00', 'yearly')$$);

-- R5 changing a plan's repeat in place (the planner's edit) and back
update schedule_blocks set repeat_kind='interval', repeat_interval=2, repeat_unit='week', days_of_week='{1,4}'
 where id='00000000-0000-4000-8000-000000000002';
select ok('R5 weekly → every 2 weeks', (select repeat_kind || ' ' || repeat_interval || ' ' || repeat_unit from schedule_blocks where id='00000000-0000-4000-8000-000000000002'), 'interval 2 week');
select ok('R5 except_dates survive the change', (select except_dates::text from schedule_blocks where id='00000000-0000-4000-8000-000000000002'), '{2026-10-12}');
update schedule_blocks set repeat_kind='weekly', repeat_interval=null, repeat_unit=null, days_of_week='{1,4}'
 where id='00000000-0000-4000-8000-000000000002';
select ok('R5 and back to weekly', (select repeat_kind from schedule_blocks where id='00000000-0000-4000-8000-000000000002'), 'weekly');
select refused('R5 a half-done change (kind without its N) is refused',
  $$update schedule_blocks set repeat_kind='interval' where id='00000000-0000-4000-8000-000000000001'$$);
-- a picked-dates plan can still leave a day out (142's except_dates)
update schedule_blocks set except_dates = array_append(except_dates, '2026-11-14') where title='Concerts';
select ok('R5 a picked-dates plan can leave a day out', (select except_dates::text from schedule_blocks where title='Concerts'), '{2026-11-14}');
