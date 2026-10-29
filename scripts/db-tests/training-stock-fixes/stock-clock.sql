-- Migration 169's S4 (a supplement schedule put back keeps its stock clock),
-- on the supplement schedules as 160 left them (supplement-schedules/base.sql,
-- 144's delete with Undo, 160) with 169's <stock-clock> section applied twice.
-- What is left = the count − the dose × the doses taken since the count
-- (stock_set_at). Setup and checks run as the superuser; Delete and Undo run
-- as `authenticated` (account 1), like the app.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create table public.t_keep (k text primary key, v jsonb);
grant all on public.t_keep to authenticated;
create or replace function public.t_left(p_id uuid) returns numeric language sql stable as $$
  select s.stock_amount - s.dose_amount * (select count(*) from public.food_log_entries f
                                            where f.supplement_schedule_id = s.id and f.created_at >= s.stock_set_at)
    from public.supplement_schedules s where s.id = p_id
$$;

-- Kreatin, 5 g a day, 500 g counted 10 days ago; 9 doses taken since.
insert into public.supplement_schedules (id, user_id, title, dose_amount, dose_unit, times, effective_from, stock_amount)
values ('51000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Kreatin', 5, 'g', '{08:00}',
        (now() at time zone 'Europe/Oslo')::date - 20, 500);
update public.supplement_schedules set stock_set_at = now() - interval '10 days' where id = '51000000-0000-4000-8000-000000000001';
insert into public.food_log_entries (user_id, date, meal_slot, custom_title, supplement_schedule_id, dose_time, created_at)
select '00000000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Oslo')::date - g, 'supplement', 'Kreatin',
       '51000000-0000-4000-8000-000000000001', '08:00', now() - (g || ' days')::interval + interval '1 hour'
  from generate_series(1, 9) g;
insert into public.t_keep select 'clock', to_jsonb(stock_set_at) from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000001';
select public.t_ok(public.t_left('51000000-0000-4000-8000-000000000001') = 455, 'before: 455 g left (500 g − 9 × 5 g)');

-- Delete with Undo (144), as the app does.
set role authenticated;
insert into public.t_keep values ('del', public.app_delete_rows('supplement_schedules', array['51000000-0000-4000-8000-000000000001']));
select public.t_ok(not exists (select 1 from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000001'),
  'S4 the schedule is deleted');
select public.app_restore_rows((select v from public.t_keep where k = 'del'));
reset role;
select public.t_ok((select stock_set_at = (select (v #>> '{}')::timestamptz from public.t_keep where k = 'clock')
                      from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000001')
                   and public.t_left('51000000-0000-4000-8000-000000000001') = 455,
  'S4 Undo puts it back with its stock clock: still 455 g left (160 restarted the clock — 500 g)');

-- A new schedule with a count starts its clock now — never one ahead of now.
insert into public.supplement_schedules (id, user_id, title, dose_amount, dose_unit, times, effective_from, stock_amount, stock_set_at)
values ('51000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Omega 3', 2, 'capsule', '{08:00}',
        (now() at time zone 'Europe/Oslo')::date, 120, null),
       ('51000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'Vitamin D', 1, 'tablet', '{08:00}',
        (now() at time zone 'Europe/Oslo')::date, 90, now() + interval '3 days'),
       ('51000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'Magnesium', 1, 'tablet', '{21:00}',
        (now() at time zone 'Europe/Oslo')::date, null, now() - interval '3 days');
select public.t_ok((select stock_set_at between now() - interval '1 minute' and now() from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000002')
                   and (select stock_set_at between now() - interval '1 minute' and now() from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000003')
                   and (select stock_set_at is null from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000004'),
  'S4 a new count starts its clock now (a clock ahead of now is not kept); no count, no clock');

-- An edit keeps the clock; a new count restarts it (160, unchanged).
update public.supplement_schedules set notes = 'with food' where id = '51000000-0000-4000-8000-000000000001';
select public.t_ok((select stock_set_at = (select (v #>> '{}')::timestamptz from public.t_keep where k = 'clock')
                      from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000001'),
  'S4 an edit keeps the stock clock');
update public.supplement_schedules set stock_amount = 450 where id = '51000000-0000-4000-8000-000000000001';
select public.t_ok((select stock_set_at between now() - interval '1 minute' and now() from public.supplement_schedules where id = '51000000-0000-4000-8000-000000000001')
                   and public.t_left('51000000-0000-4000-8000-000000000001') = 450,
  'S4 a new count restarts it (450 g left)');
