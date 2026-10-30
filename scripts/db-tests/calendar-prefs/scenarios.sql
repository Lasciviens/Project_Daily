-- Migration 172 (calendar settings): calendar_prefs is the owner's own row,
-- read and written by the app, audited and behind the owner lock;
-- icloud_credentials gains area_calendars and the derived password_sealed and
-- stays closed to the browser. Setup and checks run as the superuser; writes
-- run as `authenticated`, like the app.
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

select public.t_ok((select count(*) from pg_policies where tablename = 'calendar_prefs' and policyname = 'app_owner_lock') = 1,
  '172: the owner lock is on');
select public.t_ok(exists (select 1 from pg_trigger where tgname = 'trg_audit' and tgrelid = 'public.calendar_prefs'::regclass),
  '172: calendar settings are audited (undoable from Developer → Activity)');
select public.t_ok(has_table_privilege('authenticated', 'public.calendar_prefs', 'insert')
                   and has_table_privilege('service_role', 'public.calendar_prefs', 'select')
                   and not has_table_privilege('anon', 'public.calendar_prefs', 'select'),
  '172: the app and the icloud-calendar function may use it, anon may not');

set role authenticated;
insert into public.calendar_prefs (prefs) values ('{"areas":{"training":{"name":"Lasci · Training","emoji":"🏋️","color":"#FF9500","alertMinutes":60,"enabled":true}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
select public.t_ok((select user_id from public.calendar_prefs) = '00000000-0000-0000-0000-000000000001', 'saving stores the settings for the caller');
insert into public.calendar_prefs (prefs) values ('{"areas":{"training":{"name":"Gym","emoji":"🏋️","color":"#FF9500","alertMinutes":30,"enabled":true}}}')
  on conflict (user_id) do update set prefs = excluded.prefs;
select public.t_ok((select count(*) = 1 and max(prefs #>> '{areas,training,name}') = 'Gym' from public.calendar_prefs),
  'saving again (the app''s upsert) edits the one row — æøå and emoji kept as written');
select public.t_ok((select updated_at >= created_at from public.calendar_prefs), 'an edit moves updated_at');
select public.t_ok((select count(*) from public.audit_logs where table_name = 'calendar_prefs') = 2, 'the save and the edit are in the audit log');
select public.t_ok(public.t_err($$select area_calendars from public.icloud_credentials$$) = '42501',
  'the browser still can''t read the iCloud row (where the calendars live, the password)');

select set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
select public.t_ok((select count(*) from public.calendar_prefs) = 0, 'another account sees none of the owner''s settings');
select set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
select public.t_ok(public.t_err($$insert into public.calendar_prefs (prefs) values ('{}')$$) = '42501',
  'an account the owner lock doesn''t let in can''t write');
select set_config('test.uid', '', false);
reset role;

insert into public.icloud_credentials (user_id, apple_id, app_password) values ('00000000-0000-0000-0000-000000000001', 'ola@example.com', 'abcd-efgh-ijkl-mnop');
select public.t_ok((select area_calendars = '{}'::jsonb and password_sealed = false from public.icloud_credentials),
  'a row starts with no area calendars, and a plain password reads as not sealed');
update public.icloud_credentials set app_password = 'enc:v1:AAAA:BBBB', area_calendars = '{"training":{"url":"https://p67-caldav.icloud.com/1/calendars/lasci-training/"}}';
select public.t_ok((select password_sealed and area_calendars #>> '{training,url}' like '%lasci-training/' from public.icloud_credentials),
  'a sealed password reads as sealed; an area''s calendar is stored by the function');
select public.t_ok(public.t_err($$update public.icloud_credentials set password_sealed = false$$) = '428C9',
  'whether the password is sealed can''t be written, only derived');
