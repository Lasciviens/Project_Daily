-- Migration 160's scenarios (supplement schedules and reminders), after 160
-- ran twice. Setup and the catalogue checks run as the superuser; the app's
-- reads and writes run as `authenticated` under row level security and the
-- owner lock; phone-gateway and push-send run as the service role
-- (test.uid = 'none'). Every instant is fixed (p_now), so nothing depends on
-- the day the test runs — but for supplement_take, which refuses a day ahead
-- of today: its days are in the past. Each `ok` raises on a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_err(text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_v(p_k text) returns jsonb language sql stable as $$ select v from public.t_keep where k = p_k $$;
grant execute on function public.t_v(text) to authenticated;

-- Fixed ids
--   account 1 = the owner, 2 = a second allowed account, 3 = locked out
--   K = Kreatin (custom line, 08:00 + 20:00 every day from 01.10.2026)
--   W = Whey (a library food, 07:30, weekdays)
--   R = a recipe (21:00, every 2 days)
--   O = once-reminder (09:00), F = reminders off (09:00)
create or replace function public.t_id(p text) returns uuid language sql immutable as $$
  select case p when 'K' then '10000000-0000-4000-8000-000000000001'::uuid
                when 'W' then '10000000-0000-4000-8000-000000000002'::uuid
                when 'R' then '10000000-0000-4000-8000-000000000003'::uuid
                when 'O' then '10000000-0000-4000-8000-000000000004'::uuid
                when 'F' then '10000000-0000-4000-8000-000000000005'::uuid
                when 'food' then '20000000-0000-4000-8000-000000000001'::uuid
                when 'recipe' then '20000000-0000-4000-8000-000000000002'::uuid
                when 'u1' then '00000000-0000-0000-0000-000000000001'::uuid
                when 'u2' then '00000000-0000-0000-0000-000000000002'::uuid
                when 'u3' then '00000000-0000-0000-0000-000000000003'::uuid end
$$;
grant execute on function public.t_id(text) to authenticated;

-- ═══ 1. The tables follow the table rules ═══════════════════════════════════
select t_ok((select relrowsecurity from pg_class where oid = 'public.supplement_schedules'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.supplement_dose_state'::regclass), 'T1 row level security is on for both tables');
select t_ok((select count(*) from pg_policies where tablename in ('supplement_schedules', 'supplement_dose_state')
              and policyname like 'Users manage own supplement%' and qual ilike '%( SELECT auth.uid()%' and with_check ilike '%( SELECT auth.uid()%') = 2,
  'T1 each has its owner policy with (select auth.uid()) in USING and WITH CHECK');
select t_ok((select count(*) from pg_policies where tablename in ('supplement_schedules', 'supplement_dose_state')
              and policyname = 'app_owner_lock' and permissive = 'RESTRICTIVE') = 2, 'T1 the owner lock is applied to both');
select t_ok((select count(*) from pg_policies where tablename in ('supplement_schedules', 'supplement_dose_state')) = 4,
  'T1 a second run added no policy');
select t_ok((select count(*) from information_schema.columns where table_name in ('supplement_schedules', 'supplement_dose_state')
              and column_name = 'user_id' and column_default = 'auth.uid()') = 2, 'T1 user_id defaults to auth.uid()');
select t_ok((select count(*) from information_schema.columns where table_name in ('supplement_schedules', 'supplement_dose_state')
              and column_name in ('created_at', 'updated_at') and is_nullable = 'NO') = 4, 'T1 created_at and updated_at, not null');
select t_ok(exists (select 1 from pg_indexes where tablename = 'supplement_schedules' and indexdef ilike '%(user_id, created_at)%')
  and exists (select 1 from pg_indexes where tablename = 'supplement_dose_state' and indexdef ilike '%(user_id, dose_date)%'),
  'T1 an index on (user_id, …) for each');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.supplement_schedules'::regclass and not tgisinternal
              and tgname in ('trg_audit', 'trg_supplement_schedules_tidy')) = 2, 'T1 schedules: trg_audit and the tidy trigger, once each');
select t_ok(not exists (select 1 from pg_trigger where tgrelid = 'public.supplement_dose_state'::regclass and tgname = 'trg_audit'),
  'T1 dose state has no trg_audit (the reminder job writes it every 15 minutes)');
select t_ok(public.app_pk_column('public.supplement_schedules') = 'id' and public.app_pk_column('public.supplement_dose_state') = 'id',
  'T1 a single id key (Undo and the delete flow need one)');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.food_log_entries'::regclass and tgname = 'trg_food_log_supplement_dose_check') = 1,
  'T1 the diary''s dose check trigger, once');
select t_ok(public.app_undo_bookkeeping('supplement_schedules') = '{updated_at,synced_at,google_local_edit_at,stock_set_at}'
  and public.app_undo_bookkeeping('schedule_blocks') = '{updated_at,synced_at,google_local_edit_at,google_calendar_horizon,google_calendar_from,google_calendar_time_zone}',
  'T1 Undo this save treats the stock clock as bookkeeping; the other tables keep their lists');
select t_ok((select count(*) from cron.job where jobname = 'lascis-supplement-reminders') = 1
  and (select schedule = '*/15 * * * *' from cron.job where jobname = 'lascis-supplement-reminders'),
  'T1 the reminder job is scheduled once (applied twice), every 15 minutes');
select t_ok((select command ilike '%/functions/v1/push-send%' and command ilike '%''trigger'', ''supplements''%'
                and command ilike '%vault.decrypted_secrets%' and command ilike '%''PUSH_CRON_SECRET''%'
                and command ilike '%where exists (select 1 from public.supplement_doses_due(now()))%'
               from cron.job where jobname = 'lascis-supplement-reminders'),
  'T1 the job calls push-send (trigger supplements) only when a reminder is due, with the secret read from Vault inside');

-- ═══ 2. The repeat rule exists once ════════════════════════════════════════
insert into public.schedule_blocks (id, user_id, title, days_of_week, effective_from, except_dates, repeat_kind, repeat_interval, repeat_unit) values
  ('30000000-0000-4000-8000-000000000001', t_id('u1'), 'Every 2 weeks Tue/Thu', '{2,4}', '2026-01-07', '{2026-01-15}', 'interval', 2, 'week');
select t_ok((select bool_and(public.repeat_occurs_on(b, d::date) = public.repeat_rule_occurs_on(b.repeat_kind, b.days_of_week, b.repeat_interval,
                b.repeat_unit, b.repeat_dates, b.effective_from, b.except_dates, d::date))
               from public.schedule_blocks b, generate_series('2026-01-01'::date, '2026-03-31'::date, interval '1 day') d),
  'R2 156''s repeat_occurs_on answers what repeat_rule_occurs_on answers (it calls it)');
select t_ok((select prosrc ilike '%repeat_rule_occurs_on%' from pg_proc where proname = 'repeat_occurs_on'),
  'R2 repeat_occurs_on is now a call of the one rule');
select t_ok(not public.repeat_rule_occurs_on('weekly', '{1}', null, null, null, '2026-10-12', '{}', '2026-10-05')
  and public.repeat_rule_occurs_on('weekly', '{1}', null, null, null, '2026-10-12', '{}', '2026-10-12')
  and not public.repeat_rule_occurs_on('weekly', '{1}', null, null, null, '2026-10-12', '{2026-10-19}', '2026-10-19'),
  'R2 never before the start, never on a left-out day');

-- ═══ 3. Writes as the app makes them ═══════════════════════════════════════
insert into public.recipe_ingredient_library (id, user_id, name, unit, calories, protein_g, serving_label, serving_grams, food_group)
  values (t_id('food'), t_id('u1'), 'Whey', 'g', 400, 80, '1 scoop', 30, 'Supplements');
insert into public.recipes (id, user_id, title, servings, category, calories, protein_g)
  values (t_id('recipe'), t_id('u1'), 'Golden milk', 4, 'supplement', 120, 4);
set role authenticated;
do $$
begin
  insert into public.supplement_schedules (id, title, dose_amount, dose_unit, times, effective_from, stock_amount)
    values (t_id('K'), '  Kreatin ', 5, 'g', '{20:00:40,08:00,20:00}', '2026-10-01', 500);
  perform t_ok((select user_id = t_id('u1') from public.supplement_schedules where id = t_id('K')), 'S3 an insert without user_id belongs to the caller');
  perform t_ok((select title = 'Kreatin' and times = '{08:00,20:00}'::time[] and days_of_week = '{0,1,2,3,4,5,6}' and repeat_kind = 'weekly'
                       and remind = 'until_taken' and remind_every_min = 60 and remind_until = '22:00'
                  from public.supplement_schedules where id = t_id('K')),
    'S3 tidied: the name trimmed, times sorted, whole minutes, once each; every day, reminders every 60 min until 22:00 by default');
  perform t_ok((select stock_set_at is not null from public.supplement_schedules where id = t_id('K')), 'S3 a stock count starts its clock');
  insert into public.supplement_schedules (id, title, library_ingredient_id, dose_amount, dose_unit, times, days_of_week, effective_from)
    values (t_id('W'), 'Whey', t_id('food'), 30, 'g', '{07:30}', '{1,2,3,4,5}', '2026-10-01');
  insert into public.supplement_schedules (id, title, recipe_id, dose_amount, dose_unit, times, days_of_week, repeat_kind, repeat_interval, repeat_unit, effective_from)
    values (t_id('R'), 'Golden milk', t_id('recipe'), 1, 'serving', '{21:00}', '{}', 'interval', 2, 'day', '2026-10-01');
  insert into public.supplement_schedules (id, title, dose_amount, dose_unit, times, effective_from, remind)
    values (t_id('O'), 'Vitamin D', 1, 'capsule', '{09:00}', '2026-10-01', 'once');
  insert into public.supplement_schedules (id, title, dose_amount, dose_unit, times, effective_from, remind)
    values (t_id('F'), 'Vitamin C', 1, 'tablet', '{09:00}', '2026-10-01', 'off');
  perform t_ok((select count(*) from public.supplement_schedules) = 5, 'S3 the caller sees its five schedules');
end $$;
-- the edits in their own transactions (now() is the transaction's time)
update public.supplement_schedules set notes = 'with water' where id = t_id('K');
select t_ok((select updated_at > created_at and stock_set_at = created_at from public.supplement_schedules where id = t_id('K')),
  'S3 an edit moves updated_at; the stock clock stays while the stock does');
update public.supplement_schedules set stock_amount = 450 where id = t_id('K');
select t_ok((select stock_set_at > created_at from public.supplement_schedules where id = t_id('K')), 'S3 a new stock count restarts its clock');
reset role;
select t_ok((select count(*) from audit_logs where table_name = 'supplement_schedules' and operation = 'INSERT' and actor = 'web') = 5
  and exists (select 1 from audit_logs where table_name = 'supplement_schedules' and operation = 'UPDATE' and new_data ->> 'notes' = 'with water'),
  'S3 the app''s saves are in the activity log');

-- ═══ 4. What the tables refuse ═════════════════════════════════════════════
set role authenticated;
select t_ok(t_err($$insert into public.supplement_schedules (title, days_of_week) values ('X', '{}')$$) = '23514', 'S4 Weekly with no day is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, times) values ('X', '{}')$$) = '23514', 'S4 no time of day is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, times) values ('X', array(select make_time(h, 0, 0) from generate_series(0, 12) h))$$) = '23514',
  'S4 thirteen times a day are refused');
select t_ok(t_err(format($$insert into public.supplement_schedules (title, library_ingredient_id, recipe_id) values ('X', %L, %L)$$, t_id('food'), t_id('recipe'))) = '23514',
  'S4 a food and a recipe at once are refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, effective_from, ends_on) values ('X', '2026-10-10', '2026-10-09')$$) = '23514',
  'S4 an end before the start is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, paused_until) values ('X', '2026-10-20')$$) = '23514',
  'S4 a pause end with no pause start is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, remind) values ('X', 'sometimes')$$) = '23514', 'S4 an unknown reminder kind is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, remind_every_min) values ('X', 5)$$) = '23514', 'S4 reminders more often than every 15 minutes are refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, dose_amount) values ('X', 0)$$) = '23514', 'S4 a dose of 0 is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title) values ('   ')$$) = '23514', 'S4 a blank name is refused');
select t_ok(t_err($$insert into public.supplement_schedules (title, days_of_week, repeat_kind, repeat_dates) values ('X', '{}', 'dates', '{}')$$) = '23514',
  'S4 picked dates with no date are refused');
set test.uid = '00000000-0000-0000-0000-000000000002';
select t_ok((select count(*) from public.supplement_schedules) = 0, 'S4 another account sees none of them');
select t_ok(t_err(format($$insert into public.supplement_dose_state (schedule_id, dose_date, dose_time, skipped_at) values (%L, '2026-10-14', '08:00', now())$$, t_id('K'))) = '42501',
  'S4 a dose state naming another account''s schedule is refused');
select t_ok(t_err(format($$insert into public.food_log_entries (date, meal_slot, custom_title, supplement_schedule_id, dose_time) values ('2026-10-14', 'supplement', 'X', %L, '08:00')$$, t_id('K'))) = '42501',
  'S4 a diary line naming another account''s schedule is refused');
set test.uid = '00000000-0000-0000-0000-000000000003';
select t_ok(t_err($$insert into public.supplement_schedules (title) values ('Locked')$$) = '42501', 'S4 an account outside the allow-list cannot save one');
set test.uid = '';
select t_ok(t_err(format($$insert into public.food_log_entries (date, meal_slot, custom_title, supplement_schedule_id) values ('2026-10-14', 'supplement', 'X', %L)$$, t_id('K'))) = '23514',
  'S4 a dose''s diary line needs its dose time');
reset role;

-- ═══ 5. Taking a dose ══════════════════════════════════════════════════════
set role authenticated;
insert into public.t_keep values ('takeK', public.supplement_take(t_id('K'), '2026-10-14', '08:00', '2026-10-14 08:12+02'));
select t_ok((public.t_v('takeK') ->> 'already')::boolean = false and (public.t_v('takeK') ->> 'entry_id') is not null, 'S5 Take answers with the new diary line');
select t_ok((select meal_slot = 'supplement' and status = 'eaten' and custom_title = 'Kreatin' and quantity = 5 and unit = 'g' and calories = 0
                    and date = '2026-10-14' and dose_time = '08:00' and supplement_schedule_id = t_id('K') and created_at = '2026-10-14 08:12+02'
               from public.food_log_entries where id = (public.t_v('takeK') ->> 'entry_id')::uuid),
  'S5 a custom schedule writes its own line: the name, the dose, its values, the dose it is, at the time it was taken');
select t_ok((public.supplement_take(t_id('K'), '2026-10-14', '08:00') ->> 'entry_id') = public.t_v('takeK') ->> 'entry_id'
  and (public.supplement_take(t_id('K'), '2026-10-14', '08:00') ->> 'already')::boolean,
  'S5 taking it again finds the same line (one line per dose)');
select t_ok((select count(*) from public.food_log_entries where supplement_schedule_id = t_id('K')) = 1, 'S5 still one line');
insert into public.t_keep values ('takeW', public.supplement_take(t_id('W'), '2026-10-14', '07:30'));
select t_ok((select library_ingredient_id = t_id('food') and custom_title is null and quantity = 30 and unit = 'g' and calories = 120 and protein_g = 24
               from public.food_log_entries where id = (public.t_v('takeW') ->> 'entry_id')::uuid),
  'S5 a food''s dose is grams of that food, its totals from the food (106)');
-- 14.10 is a dose day of R (every 2 days from 01.10: 01, 03, … 13, 15)? No: 14 − 1 = 13, odd. 15.10 is.
select t_ok(t_err(format($$select public.supplement_take(%L, '2026-10-14', '21:00')$$, t_id('R'))) = '22023', 'S5 a day without a dose is refused');
insert into public.t_keep values ('takeR', public.supplement_take(t_id('R'), '2026-10-15', '21:00'));
select t_ok((select recipe_id = t_id('recipe') and quantity = 1 and unit = 'serving' and calories = 120
               from public.food_log_entries where id = (public.t_v('takeR') ->> 'entry_id')::uuid),
  'S5 a recipe''s dose is portions of it, its totals from the recipe');
select t_ok(t_err(format($$select public.supplement_take(%L, '2026-10-14', '09:15')$$, t_id('K'))) = '22023', 'S5 a time the schedule doesn''t have is refused');
select t_ok(t_err(format($$select public.supplement_take(%L, ((now() at time zone 'Europe/Oslo')::date + 1), '08:00')$$, t_id('K'))) = '22023',
  'S5 a dose ahead of its day is refused');
-- a skip and a snooze, then the dose is taken: neither stays
insert into public.supplement_dose_state (schedule_id, dose_date, dose_time, skipped_at, snoozed_until)
  values (t_id('K'), '2026-10-14', '20:00:30', '2026-10-14 20:05+02', '2026-10-14 21:05+02');
select t_ok((select dose_time = '20:00' and user_id = t_id('u1') from public.supplement_dose_state where schedule_id = t_id('K') and dose_date = '2026-10-14'),
  'S5 a skip is the caller''s and lands on the dose''s whole minute');
select public.supplement_take(t_id('K'), '2026-10-14', '20:00');
select t_ok((select skipped_at is null and snoozed_until is null from public.supplement_dose_state where schedule_id = t_id('K') and dose_date = '2026-10-14'),
  'S5 a taken dose is no longer skipped or snoozed');
select t_ok(t_err(format($$insert into public.food_log_entries (date, meal_slot, custom_title, supplement_schedule_id, dose_time) values ('2026-10-14', 'supplement', 'Kreatin', %L, '08:00')$$, t_id('K'))) = '23505',
  'S5 a second eaten line for one dose is refused');
select t_ok(t_err(format($$insert into public.food_log_entries (date, meal_slot, status, custom_title, supplement_schedule_id, dose_time) values ('2026-10-14', 'supplement', 'planned', 'Kreatin', %L, '08:00')$$, t_id('K'))) is null,
  'S5 a planned line doesn''t count as taken (and isn''t refused)');
delete from public.food_log_entries where status = 'planned';
set test.uid = '00000000-0000-0000-0000-000000000002';
select t_ok(t_err(format($$select public.supplement_take(%L, '2026-10-14', '08:00')$$, t_id('O'))) = 'P0002', 'S5 another account''s schedule is not there');
set test.uid = '';
reset role;
-- phone-gateway: the service role, for the owner
set test.uid = 'none';
insert into public.t_keep values ('takeO', public.supplement_take(t_id('O'), '2026-10-14', '09:00', null, t_id('u1')));
select t_ok((public.t_v('takeO') ->> 'already')::boolean = false
  and (select user_id = t_id('u1') from public.food_log_entries where supplement_schedule_id = t_id('O')),
  'S5 the service role takes a dose for the account it names');
select t_ok(t_err(format($$select public.supplement_take(%L, '2026-10-14', '09:00')$$, t_id('F'))) = '28000', 'S5 the service role must name the account');
set test.uid = '';
select t_ok((select count(*) from audit_logs where table_name = 'food_log_entries' and operation = 'INSERT'
               and new_data ->> 'status' = 'eaten' and new_data ->> 'supplement_schedule_id' is not null) = 5,
  'S5 every taken dose is in the activity log (Undo this save takes it back)');

-- ═══ 6. The doses and their states ═════════════════════════════════════════
-- 14.10.2026 (Wed): K 08:00 taken, K 20:00 taken; W 07:30 taken; O 09:00 taken; F 09:00 open.
-- 15.10.2026 (Thu): K skipped at 08:00, nothing else.
insert into public.supplement_dose_state (user_id, schedule_id, dose_date, dose_time, skipped_at)
  values (t_id('u1'), t_id('K'), '2026-10-15', '08:00', '2026-10-15 09:00+02');
create or replace function public.t_status(p text, p_day date, p_time time, p_now timestamptz) returns text language sql stable as $$
  select status from public.supplement_doses(t_id('u1'), p_day, p_day, p_now) where schedule_id = t_id(p) and dose_time = p_time
$$;
select t_ok(t_status('K', '2026-10-14', '08:00', '2026-10-16 12:00+02') = 'taken'
  and t_status('F', '2026-10-14', '09:00', '2026-10-16 12:00+02') = 'missed'
  and t_status('K', '2026-10-15', '08:00', '2026-10-16 12:00+02') = 'skipped'
  and t_status('K', '2026-10-15', '20:00', '2026-10-15 19:59+02') = 'upcoming'
  and t_status('K', '2026-10-15', '20:00', '2026-10-15 20:00+02') = 'due'
  and t_status('K', '2026-10-15', '20:00', '2026-10-16 00:00+02') = 'missed',
  'S6 taken, missed (a past day), skipped, upcoming, due (from its minute, all day) — in Oslo time');
select t_ok(t_status('K', '2026-10-15', '20:00', '2026-10-15 18:30+00') = 'due' and t_status('K', '2026-10-15', '20:00', '2026-10-15 17:59+00') = 'upcoming',
  'S6 the clock is Oslo''s, whatever the instant''s zone (18:30 UTC = 20:30 in Oslo)');
select t_ok((select count(*) from public.supplement_doses(t_id('u1'), '2026-10-17', '2026-10-17', '2026-10-17 12:00+02') where schedule_id = t_id('W')) = 0
  and (select count(*) from public.supplement_doses(t_id('u1'), '2026-10-16', '2026-10-16', '2026-10-17 12:00+02') where schedule_id = t_id('W')) = 1,
  'S6 the repeat rule: weekdays only (Sat 17.10 none, Fri 16.10 one)');
select t_ok((select count(*) from public.supplement_doses(t_id('u1'), '2026-09-01', '2026-09-30', '2026-10-17 12:00+02')) = 0, 'S6 nothing before the start');
update public.supplement_schedules set paused_from = '2026-10-20', paused_until = '2026-10-22', ends_on = '2026-10-31' where id = t_id('K');
select t_ok((select string_agg(distinct to_char(dose_date, 'DD'), ',' order by to_char(dose_date, 'DD'))
               from public.supplement_doses(t_id('u1'), '2026-10-18', '2026-11-02', '2026-10-17 12:00+02') where schedule_id = t_id('K'))
              = '18,19,23,24,25,26,27,28,29,30,31',
  'S6 no doses while paused (20–22.10) or after the end (31.10)');
update public.supplement_schedules set paused_from = null, paused_until = null, ends_on = null where id = t_id('K');
select t_ok((select dose_label from public.supplement_doses(t_id('u1'), '2026-10-15', '2026-10-15', '2026-10-16 12:00+02') where schedule_id = t_id('R')) = '1 portion'
  and public.supplement_dose_label(2, 'capsule') = '2 capsules' and public.supplement_dose_label(1, 'capsule') = '1 capsule'
  and public.supplement_dose_label(0.5, 'tablet') = '0.5 tablet'
  and public.supplement_dose_label(2.50, 'g') = '2.5 g' and public.supplement_dose_label(2, 'serving') = '2 portions'
  and public.supplement_dose_label(1000, 'IU') = '1000 IU',
  'S6 the dose''s label: "1 portion", "2 capsules", "1 capsule", "0.5 tablet" (one or less stays one), "2.5 g", "1000 IU"');
update public.recipes set serving_label = 'glass' where id = t_id('recipe');
select t_ok((select dose_label from public.supplement_doses(t_id('u1'), '2026-10-15', '2026-10-15', '2026-10-16 12:00+02') where schedule_id = t_id('R')) = '1 glass'
  and public.supplement_dose_label(2, 'serving', 'glass') = '2 glasses' and public.supplement_dose_label(3, 'serving', 'piece') = '3 pieces'
  and public.supplement_dose_label(2, 'serving', 'berry') = '2 berries' and public.supplement_dose_label(2, 'serving', ' ') = '2 portions',
  'S6 a recipe''s dose counts its own portion word (157): "1 glass", "2 glasses", "3 pieces", "2 berries" — like the diary');
update public.recipes set serving_label = null where id = t_id('recipe');

-- ═══ 7. Reminders ══════════════════════════════════════════════════════════
-- 16.10.2026 (Fri) in Oslo: K 08:00 + 20:00, W 07:30, O 09:00 (once), F 09:00 (off), R not (16 − 1 = 15, odd).
create or replace function public.t_due(p_now timestamptz) returns text language sql stable as $$
  select coalesce(string_agg((select s.title from public.supplement_schedules s where s.id = d.schedule_id) || ' ' || to_char(d.dose_time, 'HH24:MI'), ', '
                    order by d.dose_time, d.title), '-')
    from public.supplement_doses_due(p_now) d where d.user_id = t_id('u1')
$$;
create or replace function public.t_claim(p_now timestamptz) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', 'none', true);
  select coalesce(string_agg(c.title || ' ' || to_char(c.dose_time, 'HH24:MI'), ', ' order by c.dose_time, c.title), '-') into r
    from public.supplement_reminders_claim(t_id('u1'), p_now) c;
  perform set_config('test.uid', '', true);
  return r;
end $$;
select t_ok(t_due('2026-10-16 07:29+02') = '-', 'S7 nothing before the first dose''s time');
select t_ok(t_due('2026-10-16 07:30+02') = 'Whey 07:30', 'S7 Whey''s reminder at its time');
select t_ok(t_claim('2026-10-16 07:30+02') = 'Whey 07:30', 'S7 the claim returns it …');
select t_ok(t_claim('2026-10-16 07:30+02') = '-' and t_due('2026-10-16 07:45+02') = '-', 'S7 … and stamps it: not again at once, nor a quarter later');
select t_ok((select reminders_sent = 1 and last_reminded_at = '2026-10-16 07:30+02' from public.supplement_dose_state where schedule_id = t_id('W') and dose_date = '2026-10-16'),
  'S7 the stamp: when, and how many');
select t_ok(t_due('2026-10-16 08:00+02') = 'Kreatin 08:00', 'S7 Kreatin at 08:00 (Whey was reminded 30 minutes ago)');
select t_ok(t_claim('2026-10-16 08:00+02') = 'Kreatin 08:00', 'S7 claimed');
select t_ok(t_due('2026-10-16 08:25+02') = 'Whey 07:30', 'S7 Whey again 55 minutes on (every 60, 5 minutes'' grace for the 15-minute job)');
select t_ok(t_claim('2026-10-16 08:30+02') = 'Whey 07:30', 'S7 claimed at the 08:30 run');
select t_ok(t_due('2026-10-16 09:00+02') = 'Kreatin 08:00, Vitamin D 09:00', 'S7 at 09:00: Kreatin''s hour and the once-reminder; never the one with reminders off');
select t_ok(t_claim('2026-10-16 09:00+02') = 'Kreatin 08:00, Vitamin D 09:00', 'S7 claimed');
select t_ok(position('Vitamin D' in t_due('2026-10-16 10:00+02')) = 0, 'S7 a once-reminder never comes again');
-- the owner snoozes Kreatin at 09:10 for an hour, then skips Whey
update public.supplement_dose_state set snoozed_until = '2026-10-16 10:10+02' where schedule_id = t_id('K') and dose_date = '2026-10-16' and dose_time = '08:00';
insert into public.supplement_dose_state (user_id, schedule_id, dose_date, dose_time, skipped_at)
  values (t_id('u1'), t_id('W'), '2026-10-16', '07:30', '2026-10-16 09:10+02')
  on conflict (schedule_id, dose_date, dose_time) do update set skipped_at = excluded.skipped_at;
select t_ok(t_due('2026-10-16 10:00+02') = '-', 'S7 snoozed: no reminder until the snooze ends; skipped: none at all');
select t_ok(t_due('2026-10-16 10:15+02') = 'Kreatin 08:00', 'S7 the first run after the snooze ends reminds again');
select t_ok(t_claim('2026-10-16 10:15+02') = 'Kreatin 08:00', 'S7 claimed');
select t_ok(t_due('2026-10-16 10:45+02') = '-' and t_due('2026-10-16 11:15+02') = 'Kreatin 08:00', 'S7 then every hour again');
select t_ok(t_due('2026-10-16 21:59+02') = 'Kreatin 08:00, Kreatin 20:00' and t_due('2026-10-16 22:00+02') = '-',
  'S7 the window ends at 22:00 (remind_until)');
update public.supplement_schedules set times = '{08:00,22:30}' where id = t_id('K');
select t_ok(t_due('2026-10-16 22:30+02') = 'Kreatin 22:30' and t_due('2026-10-16 22:45+02') = '-',
  'S7 a dose after the window''s end still gets its one reminder in its own quarter hour');
update public.supplement_schedules set times = '{08:00,20:00}' where id = t_id('K');
-- taken by the phone at 11:20: no more reminders for it
set test.uid = 'none';
select public.supplement_take(t_id('K'), '2026-10-16', '08:00', '2026-10-16 11:20+02', t_id('u1'));
set test.uid = '';
select t_ok(position('Kreatin 08:00' in t_due('2026-10-16 12:15+02')) = 0, 'S7 a taken dose is never reminded of');
-- the locked-out account's schedule is never reminded of
insert into public.supplement_schedules (user_id, title, times, effective_from) values (t_id('u3'), 'Locked', '{09:00}', '2026-10-01');
select t_ok(not exists (select 1 from public.supplement_doses_due('2026-10-16 09:00+02') where user_id = t_id('u3')),
  'S7 an account outside the allow-list gets no reminder');

-- ═══ 8. The job's own command ══════════════════════════════════════════════
-- The stored command as pg_cron runs it, at a fixed instant (its now() set
-- to 16.10.2026 09:00 in Oslo): Kreatin 08:00 is taken, Whey skipped,
-- Vitamin D reminded once, Vitamin C off — nothing due, no request.
create or replace function public.t_run_job(p_now text) returns void language plpgsql as $$
begin
  execute replace((select command from cron.job where jobname = 'lascis-supplement-reminders'), 'now()', format('%L::timestamptz', p_now));
end $$;
select public.t_run_job('2026-10-16 09:00+02');
select t_ok((select count(*) from net.t_calls) = 0, 'S8 nothing due: the job makes no request');
update public.supplement_schedules set remind = 'until_taken' where id = t_id('F');
select public.t_run_job('2026-10-16 09:00+02');
select t_ok((select count(*) = 1 and bool_and(url like '%/functions/v1/push-send' and body = '{"trigger": "supplements"}'
                and headers ->> 'x-cron-secret' = 'test-cron-secret') from net.t_calls),
  'S8 Vitamin C reminds now: one call to push-send (trigger supplements) with the Vault secret');
update public.supplement_schedules set remind = 'off' where id = t_id('F');

-- ═══ 9. The phone's log_supplement ═════════════════════════════════════════
create or replace function public.t_for_log(p_title text, p_now timestamptz, p_schedule uuid default null) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', 'none', true);
  select coalesce(min(l.title || ' ' || to_char(l.dose_time, 'HH24:MI')), '-') into r
    from public.supplement_dose_for_log(t_id('u1'), p_title, p_schedule, p_now) l;
  perform set_config('test.uid', '', true);
  return r;
end $$;
select t_ok(t_for_log('Kreatin 5 g', '2026-10-17 07:00+02') = 'Kreatin 08:00', 'S9 "Kreatin 5 g" before 08:00 takes the next open dose (08:00)');
select t_ok(t_for_log('kreatin', '2026-10-17 21:00+02') = 'Kreatin 08:00', 'S9 at 21:00 the earliest one still due (08:00), before 20:00''s');
-- the 08:00 dose of 17.10 taken (its line, as a Take writes it)
insert into public.food_log_entries (user_id, date, meal_slot, custom_title, supplement_schedule_id, dose_time)
  values (t_id('u1'), '2026-10-17', 'supplement', 'Kreatin', t_id('K'), '08:00');
select t_ok(t_for_log('Kreatin', '2026-10-17 21:00+02') = 'Kreatin 20:00', 'S9 with 08:00 taken, 20:00''s');
select t_ok(t_for_log('Vitamin', '2026-10-17 09:30+02') = '-', 'S9 "Vitamin" alone is neither Vitamin C nor Vitamin D …');
select t_ok(t_for_log('Vitamin E', '2026-10-17 09:30+02') = '-' and t_for_log('Vitamin D3', '2026-10-17 09:30+02') = '-',
  'S9 … "Vitamin E" and "Vitamin D3" are not "Vitamin D" …');
select t_ok(t_for_log('Vitamin D 1 capsule', '2026-10-17 09:30+02') = 'Vitamin D 09:00', 'S9 … and "Vitamin D 1 capsule" is');
select t_ok(t_for_log('anything', '2026-10-17 09:30+02', t_id('W')) = '-' and t_for_log('anything', '2026-10-14 09:30+02', t_id('O')) = '-'
  and t_for_log('anything', '2026-10-17 09:30+02', t_id('O')) = 'Vitamin D 09:00',
  'S9 a schedule named by id: its open dose; none on a day it has none (Whey on Saturday) or when it is taken');
-- Mon 19.10.2026: Whey (07:30, weekdays) has an open dose. A schedule is named
-- after its linked food as well as its own name.
update public.supplement_schedules set title = 'Morning protein' where id = t_id('W');
select t_ok(t_for_log('Whey 30 g', '2026-10-19 07:00+02') = 'Morning protein 07:30', 'S9 "Whey 30 g" finds the schedule through its linked food''s name');
update public.recipe_ingredient_library set name = 'Whey protein isolate, vanilla' where id = t_id('food');
update public.supplement_schedules set title = 'Whey protein isolate' where id = t_id('W');
select t_ok(t_for_log('Whey 30 g', '2026-10-19 07:00+02') = 'Whey protein isolate 07:30',
  'S9 … and a long product name still answers to its first word ("Whey 30 g" ↔ "Whey protein isolate, vanilla")');
select t_ok(t_for_log('Whey shake', '2026-10-19 07:00+02') = '-', 'S9 … but "Whey shake" is not "Whey protein isolate"');
update public.supplement_schedules set title = 'Whey' where id = t_id('W');
update public.recipe_ingredient_library set name = 'Whey' where id = t_id('food');
-- Two names that start alike: the one sharing more words wins; a tie is nobody's.
insert into public.supplement_schedules (user_id, title, dose_amount, dose_unit, times, effective_from) values
  (t_id('u1'), 'Omega-3 fish oil', 2, 'capsule', '{09:00}', '2026-10-01'),
  (t_id('u1'), 'Omega-6', 1, 'capsule', '{09:00}', '2026-10-01');
select t_ok(t_for_log('Omega-3 2 capsules', '2026-10-19 09:30+02') = 'Omega-3 fish oil 09:00', 'S9 "Omega-3 2 capsules" is Omega-3''s, not Omega-6''s');
select t_ok(t_for_log('Omega 2 capsules', '2026-10-19 09:30+02') = '-', 'S9 "Omega 2 capsules" names both equally: nobody''s');
select t_ok(public.supplement_log_rank('Kreatin 5 g', 'Kreatin') > public.supplement_log_rank('Kreatin 5 g', 'Kreatin monohydrat, Bodylab')
  and public.supplement_log_rank('Kreatin 5 g', 'Kreatin monohydrat, Bodylab') > 0 and public.supplement_log_rank('Kreatinine', 'Kreatin') = 0,
  'S9 the whole name beats a first word; another word never matches');
delete from public.supplement_schedules where title in ('Omega-3 fish oil', 'Omega-6');
set role authenticated;
select t_ok(t_err(format($$select * from public.supplement_dose_for_log(%L, 'Kreatin')$$, t_id('u1'))) = '42501'
  and t_err($$select * from public.supplement_doses_due()$$) = '42501'
  and t_err(format($$select * from public.supplement_reminders_claim(%L)$$, t_id('u1'))) = '42501',
  'S9 the server-only reads are closed to a signed-in caller');
reset role;

-- ═══ 10. Deleting a schedule, with Undo ═════════════════════════════════════
set role authenticated;
insert into public.t_keep values ('delK', public.app_delete_rows('supplement_schedules', array[t_id('K')::text]));
select t_ok(not exists (select 1 from public.supplement_schedules where id = t_id('K'))
  and not exists (select 1 from public.supplement_dose_state where schedule_id = t_id('K')), 'S10 the schedule goes, and its dose states with it');
select t_ok((select count(*) from public.food_log_entries where custom_title = 'Kreatin' and supplement_schedule_id is null) >= 3,
  'S10 its taken doses stay in the diary as plain lines');
select public.app_restore_rows(public.t_v('delK'));
select t_ok(exists (select 1 from public.supplement_schedules where id = t_id('K'))
  and (select count(*) from public.supplement_dose_state where schedule_id = t_id('K')) >= 2
  and not exists (select 1 from public.food_log_entries where custom_title = 'Kreatin' and supplement_schedule_id is null),
  'S10 Undo brings back the schedule, its states and the links of its diary lines');
reset role;

-- ═══ 11. Times changed after a dose was taken or skipped ═══════════════════
-- "Moved" was taken at 08:00 on 16.10 (and skipped at 08:00 on 15.10); then
-- the owner moves it to 07:30. The day keeps its taken dose (no reminders),
-- the history its skip; a line at a time with no dose left over stays a line.
insert into public.supplement_schedules (id, user_id, title, dose_amount, dose_unit, times, effective_from)
  values ('10000000-0000-4000-8000-000000000009', t_id('u1'), 'Moved', 1, 'tablet', '{08:00}', '2026-10-14');
insert into public.food_log_entries (id, user_id, date, meal_slot, custom_title, supplement_schedule_id, dose_time, created_at) values
  ('40000000-0000-4000-8000-000000000001', t_id('u1'), '2026-10-16', 'supplement', 'Moved', '10000000-0000-4000-8000-000000000009', '08:00', '2026-10-16 08:05+02');
insert into public.supplement_dose_state (user_id, schedule_id, dose_date, dose_time, skipped_at)
  values (t_id('u1'), '10000000-0000-4000-8000-000000000009', '2026-10-15', '08:00', '2026-10-15 08:30+02');
update public.supplement_schedules set times = '{07:30}' where title = 'Moved';
create or replace function public.t_moved(p_day date, p_now timestamptz) returns text language sql stable as $$
  select coalesce(string_agg(to_char(d.dose_time, 'HH24:MI') || ' ' || d.status || coalesce(' ' || right(d.entry_id::text, 2), ''), ', ' order by d.dose_time), '-')
    from public.supplement_doses(t_id('u1'), p_day, p_day, p_now) d where d.title = 'Moved'
$$;
select t_ok(t_moved('2026-10-16', '2026-10-16 09:00+02') = '07:30 taken 01', 'S11 moved to 07:30 after taking it at 08:00: today''s dose reads taken, by that line');
select t_ok(position('Moved' in t_due('2026-10-16 09:00+02')) = 0 and position('Moved' in t_due('2026-10-16 21:00+02')) = 0,
  'S11 … so no reminder comes for it');
select t_ok(t_moved('2026-10-15', '2026-10-16 09:00+02') = '07:30 skipped' and t_moved('2026-10-14', '2026-10-16 09:00+02') = '07:30 missed',
  'S11 the history keeps the skip (15.10) and the miss (14.10)');
select t_ok(t_for_log('Moved', '2026-10-16 09:00+02') = '-', 'S11 the phone finds no open dose to take again');
-- two times now, two lines at old times: paired in time order; one dose more than lines stays open
insert into public.food_log_entries (id, user_id, date, meal_slot, custom_title, supplement_schedule_id, dose_time, created_at) values
  ('40000000-0000-4000-8000-000000000002', t_id('u1'), '2026-10-16', 'supplement', 'Moved', '10000000-0000-4000-8000-000000000009', '21:00', '2026-10-16 21:05+02');
update public.supplement_schedules set times = '{07:30,12:00,20:00}' where title = 'Moved';
select t_ok(t_moved('2026-10-16', '2026-10-16 23:00+02') = '07:30 taken 01, 12:00 taken 02, 20:00 due',
  'S11 lines at 08:00 and 21:00 go to 07:30 and 12:00 (time order); 20:00 has none');
-- a line at a dose's own time is that dose's; the others share what is left
insert into public.food_log_entries (id, user_id, date, meal_slot, custom_title, supplement_schedule_id, dose_time, created_at) values
  ('40000000-0000-4000-8000-000000000003', t_id('u1'), '2026-10-16', 'supplement', 'Moved', '10000000-0000-4000-8000-000000000009', '07:30', '2026-10-16 07:40+02');
select t_ok(t_moved('2026-10-16', '2026-10-16 23:00+02') = '07:30 taken 03, 12:00 taken 01, 20:00 taken 02',
  'S11 the 07:30 line is 07:30''s; 08:00 and 21:00 go to 12:00 and 20:00');
update public.supplement_schedules set times = '{07:30}' where title = 'Moved';
select t_ok(t_moved('2026-10-16', '2026-10-16 23:00+02') = '07:30 taken 03'
  and (select count(*) from public.food_log_entries where supplement_schedule_id = '10000000-0000-4000-8000-000000000009' and date = '2026-10-16') = 3,
  'S11 one time left: the lines left over belong to no dose and stay in the diary');

