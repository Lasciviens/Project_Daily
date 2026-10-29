-- Migration 170 (the day's diary): one row per day, the owner's own, edited
-- in place, undone by a delete, audited, and closed to other accounts by row
-- level security and the owner lock. Setup and checks run as the superuser;
-- writes run as `authenticated`, like the app.
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

select public.t_ok((select count(*) from pg_policies where tablename = 'diary_entries' and policyname = 'app_owner_lock') = 1,
  '170: the owner lock is on');
select public.t_ok(exists (select 1 from pg_trigger where tgname = 'trg_audit' and tgrelid = 'public.diary_entries'::regclass),
  '170: the diary is audited (undoable from Developer → Activity)');
select public.t_ok(has_table_privilege('service_role', 'public.diary_entries', 'insert')
                   and not has_table_privilege('anon', 'public.diary_entries', 'select'),
  '170: the service role may write it (the assistant), anon may not read it');

set role authenticated;
insert into public.diary_entries (day, body) values ('2026-10-28', 'Long walk by the river.')
  on conflict (user_id, day) do update set body = excluded.body;
select public.t_ok((select user_id from public.diary_entries where day = '2026-10-28') = '00000000-0000-0000-0000-000000000001',
  'writing a day stores it for the caller');
insert into public.diary_entries (day, body) values ('2026-10-28', 'Long walk by the river. Pizza with Ola.')
  on conflict (user_id, day) do update set body = excluded.body;
select public.t_ok((select count(*) = 1 and max(body) = 'Long walk by the river. Pizza with Ola.' from public.diary_entries),
  'saving the same day again (the app''s upsert) edits it in place — one row per day');
select public.t_ok((select updated_at >= created_at from public.diary_entries where day = '2026-10-28'), 'an edit moves updated_at');
select public.t_ok(public.t_err($$insert into public.diary_entries (day) values (null)$$) = '23502', 'an entry needs its day');
select public.t_ok(public.t_err($$insert into public.diary_entries (day, body) values ('2026-10-29', repeat('x', 20001))$$) = '23514',
  'an entry is at most 20,000 characters');
select public.t_ok((select count(*) from public.audit_logs where table_name = 'diary_entries') = 2,
  'the write and the edit are in the audit log');

select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) from public.diary_entries) = 0, 'another account sees none of the owner''s diary');
insert into public.diary_entries (day, body) values ('2026-10-28', 'Mine.');
select public.t_ok((select count(*) from public.diary_entries) = 1, 'another account writes its own day with the same date');
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
select public.t_ok(public.t_err($$insert into public.diary_entries (day, body) values ('2026-10-29', 'x')$$) = '42501',
  'an account the owner lock doesn''t let in can''t write');
select set_config('test.uid', '', false);

delete from public.diary_entries where day = '2026-10-28';
select public.t_ok((select count(*) from public.diary_entries) = 0, 'a delete takes the day''s entry away');
reset role;
select public.t_ok((select count(*) from public.diary_entries where user_id = '00000000-0000-0000-0000-000000000002') = 1,
  'the other account''s entry is untouched by the owner''s delete');
