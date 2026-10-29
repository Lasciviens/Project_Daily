-- Migration 171 (iCloud credentials): a token table. The service role reads
-- and writes it; the browser (authenticated) and anon can neither read nor
-- write it; the owner lock is on. Setup and checks run as the superuser.
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

select public.t_ok((select count(*) from pg_policies where tablename = 'icloud_credentials' and policyname = 'app_owner_lock') = 1,
  '171: the owner lock is on');
select public.t_ok((select count(*) from pg_policies where tablename = 'icloud_credentials' and policyname <> 'app_owner_lock') = 0,
  '171: no browser policy');
select public.t_ok(not has_table_privilege('authenticated', 'public.icloud_credentials', 'select')
                   and not has_table_privilege('authenticated', 'public.icloud_credentials', 'insert')
                   and not has_table_privilege('anon', 'public.icloud_credentials', 'select'),
  '171: the browser can neither read nor write the credentials');
select public.t_ok(has_table_privilege('service_role', 'public.icloud_credentials', 'select')
                   and has_table_privilege('service_role', 'public.icloud_credentials', 'update'),
  '171: the service role (the icloud-calendar function) reads and writes them');
select public.t_ok(not exists (select 1 from pg_trigger where tgname = 'trg_audit' and tgrelid = 'public.icloud_credentials'::regclass),
  '171: a credential never goes into the audit log');

insert into public.icloud_credentials (user_id, apple_id, app_password)
values ('00000000-0000-0000-0000-000000000001', 'ola@example.com', 'abcd-efgh-ijkl-mnop');
set role authenticated;
select public.t_ok(public.t_err($$select app_password from public.icloud_credentials$$) = '42501',
  'signed in, the owner still can''t read the password from the browser');
select public.t_ok(public.t_err($$insert into public.icloud_credentials (apple_id, app_password) values ('x@example.com', 'y')$$) = '42501',
  'nor write one');
reset role;
update public.icloud_credentials set test_sync_token = 'tok-1' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select updated_at >= created_at and test_sync_token = 'tok-1' from public.icloud_credentials), 'an update moves updated_at');
