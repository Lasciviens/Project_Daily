-- Migration 181 (a time on every food log): the database fills the time for
-- every writer that sends none — the moment it was written when that is on
-- the log's own day in Oslo, else its meal's usual time; a sent time is kept
-- (to the minute); planned rows have none; a log from before 181 keeps none.
-- Setup and checks run as the superuser; writes run as `authenticated`, like
-- the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- Oslo's day and minute now, as the trigger reads them.
create or replace function public.t_oslo_day() returns date language sql stable as $$ select (now() at time zone 'Europe/Oslo')::date $$;
create or replace function public.t_near_now(t time) returns boolean language sql stable as $$
  select abs(extract(epoch from (date_trunc('minute', now() at time zone 'Europe/Oslo')::time - t))) <= 60
$$;
grant execute on function public.t_oslo_day() to authenticated;
grant execute on function public.t_near_now(time) to authenticated;

-- ═══ 0. The migration itself ═══════════════════════════════════════════════
select public.t_ok((select atttypid = 'time'::regtype and not attnotnull from pg_attribute
                     where attrelid = 'public.food_log_entries'::regclass and attname = 'eaten_time' and not attisdropped),
  '181: food_log_entries.eaten_time is a time of day, empty allowed (a planned row, an older log)');
select public.t_ok((select count(*) from pg_trigger where tgname = 'trg_food_log_eaten_time' and tgrelid = 'public.food_log_entries'::regclass) = 1,
  '181: one time trigger after two runs');

-- An older log, written before 181 (no trigger yet): it keeps no time.
alter table public.food_log_entries disable trigger trg_food_log_eaten_time;
insert into public.food_log_entries (user_id, date, meal_slot, custom_title, calories)
values ('00000000-0000-0000-0000-000000000001', date '2026-10-20', 'lunch', 'Old lunch', 500);
alter table public.food_log_entries enable trigger trg_food_log_eaten_time;

-- ═══ 1. As the owner, like the app ═══════════════════════════════════════
set role authenticated;

insert into public.food_log_entries (date, meal_slot, custom_title, calories) values (public.t_oslo_day(), 'dinner', 'Now dinner', 700);
select public.t_ok((select public.t_near_now(eaten_time) from public.food_log_entries where custom_title = 'Now dinner'),
  'a log for today with no time gets the time it is logged (Oslo, to the minute)');

insert into public.food_log_entries (date, meal_slot, custom_title, calories) values (public.t_oslo_day() - 1, 'breakfast', 'Yesterday breakfast', 300);
select public.t_ok((select eaten_time = time '07:00' from public.food_log_entries where custom_title = 'Yesterday breakfast'),
  'a log for another day gets its meal''s usual time (breakfast 07:00)');
insert into public.food_log_entries (date, meal_slot, custom_title) values (public.t_oslo_day() + 2, 'supplement', 'Later dose');
select public.t_ok((select eaten_time = time '21:00' from public.food_log_entries where custom_title = 'Later dose'),
  'and a supplement another day 21:00 (the Diary''s hours)');

insert into public.food_log_entries (date, meal_slot, custom_title, eaten_time) values (public.t_oslo_day() - 3, 'snack', 'Picked time', time '08:12:45');
select public.t_ok((select eaten_time = time '08:12' from public.food_log_entries where custom_title = 'Picked time'),
  'a time the logger sends is kept, to the minute');

insert into public.food_log_entries (date, meal_slot, custom_title, created_at)
values (public.t_oslo_day(), 'supplement', 'Taken earlier', (public.t_oslo_day() + time '06:30') at time zone 'Europe/Oslo');
select public.t_ok((select eaten_time = time '06:30' from public.food_log_entries where custom_title = 'Taken earlier'),
  'a dose "Taken at 06:30" (supplement_take writes created_at) gets that time');

insert into public.food_log_entries (date, meal_slot, custom_title, status) values (public.t_oslo_day(), 'lunch', 'Planned lunch', 'planned');
select public.t_ok((select eaten_time is null from public.food_log_entries where custom_title = 'Planned lunch'),
  'a planned row has no time');
update public.food_log_entries set status = 'eaten' where custom_title = 'Planned lunch';
select public.t_ok((select public.t_near_now(eaten_time) from public.food_log_entries where custom_title = 'Planned lunch'),
  'ticked eaten today: the time it was ticked');
update public.food_log_entries set status = 'planned' where custom_title = 'Planned lunch';
select public.t_ok((select eaten_time is null from public.food_log_entries where custom_title = 'Planned lunch'),
  'put back to planned: no time');
insert into public.food_log_entries (date, meal_slot, custom_title, status) values (public.t_oslo_day() + 1, 'dinner', 'Planned tomorrow', 'planned');
update public.food_log_entries set status = 'eaten' where custom_title = 'Planned tomorrow';
select public.t_ok((select eaten_time = time '18:00' from public.food_log_entries where custom_title = 'Planned tomorrow'),
  'a planned row for another day ticked eaten: its meal''s usual time (dinner 18:00)');

update public.food_log_entries set eaten_time = time '13:05' where custom_title = 'Now dinner';
select public.t_ok((select eaten_time = time '13:05' from public.food_log_entries where custom_title = 'Now dinner'),
  'the edit popup''s time is kept');
update public.food_log_entries set eaten_time = null where custom_title = 'Picked time';
select public.t_ok((select eaten_time is null from public.food_log_entries where custom_title = 'Picked time'),
  'an eaten row''s time cleared on purpose stays clear (Undo puts an older log back to no time)');
update public.food_log_entries set calories = 520 where custom_title = 'Old lunch';
select public.t_ok((select eaten_time is null and calories = 520 from public.food_log_entries where custom_title = 'Old lunch'),
  'an older log edited in anything but its time keeps no time (never a made-up one)');
