-- Migration 164 (a sleep night confirmed complete): one row per night, the
-- owner's own, undone by a delete, audited, and closed to other accounts by
-- row level security and the owner lock. Setup and checks run as the
-- superuser; writes run as `authenticated`, like the app.
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

select public.t_ok((select count(*) from pg_policies where tablename = 'sleep_night_confirmations' and policyname = 'app_owner_lock') = 1,
  '164: the owner lock is on');
select public.t_ok(exists (select 1 from pg_trigger where tgname = 'trg_audit' and tgrelid = 'public.sleep_night_confirmations'::regclass),
  '164: confirmations are audited (undoable from Developer → Activity)');

set role authenticated;
insert into public.sleep_night_confirmations (night_date) values ('2026-10-18');
select public.t_ok((select user_id from public.sleep_night_confirmations where night_date = '2026-10-18') = '00000000-0000-0000-0000-000000000001',
  'confirming a night stores it for the caller');
select public.t_ok(public.t_err($$insert into public.sleep_night_confirmations (night_date) values ('2026-10-18')$$) = '23505',
  'a night is confirmed once');
insert into public.sleep_night_confirmations (night_date) values ('2026-10-18') on conflict (user_id, night_date) do nothing;
select public.t_ok((select count(*) from public.sleep_night_confirmations) = 1, 'confirming it again (the app''s upsert) changes nothing');
select public.t_ok(public.t_err($$insert into public.sleep_night_confirmations (night_date) values (null)$$) = '23502', 'a confirmation needs its night');
select public.t_ok((select count(*) from public.audit_logs where table_name = 'sleep_night_confirmations' and operation = 'INSERT') = 1,
  'the confirmation is in the audit log');

select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) from public.sleep_night_confirmations) = 0, 'another account sees none of the owner''s confirmations');
delete from public.sleep_night_confirmations where night_date = '2026-10-18';
insert into public.sleep_night_confirmations (night_date) values ('2026-10-18');
select public.t_ok((select count(*) from public.sleep_night_confirmations) = 1, 'another account confirms its own night with the same date');
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
select public.t_ok(public.t_err($$insert into public.sleep_night_confirmations (night_date) values ('2026-10-19')$$) = '42501',
  'an account the owner lock doesn''t let in can''t confirm');
select set_config('test.uid', '', false);

delete from public.sleep_night_confirmations where night_date = '2026-10-18';
select public.t_ok((select count(*) from public.sleep_night_confirmations) = 0, 'Undo (a delete) takes the confirmation back');
reset role;
select public.t_ok((select count(*) from public.sleep_night_confirmations where user_id = '00000000-0000-0000-0000-000000000002') = 1,
  'the other account''s confirmation is untouched by the owner''s delete');
