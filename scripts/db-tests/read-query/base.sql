-- The world migration 185's scenarios run in (scripts/verify-db-read-query.mjs), set up as Supabase's API reaches the
-- database: PostgREST signs in as `authenticator` (it may become anon, authenticated or service_role) and switches to
-- the caller's role for each request. Supabase's auth.uid() reads the request's JWT claims. A token table only the
-- service role reads (as 044 left them), and a table the owner's policy scopes to its own rows.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator nologin noinherit; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default grants: every function a migration creates in public may be called by all three API roles
-- until the migration revokes it (140 and 185 revoke anon; the service role keeps it).
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- 139's list of the accounts that may use the app (is_app_user() itself is 139's own text, run by the script).
create table public.app_allowed_users (user_id uuid primary key, note text);
insert into public.app_allowed_users values ('00000000-0000-0000-0000-00000000000a', 'owner');
alter table public.app_allowed_users enable row level security;

create table public.trakt_tokens (user_id uuid primary key, access_token text not null);
alter table public.trakt_tokens enable row level security;
revoke all on public.trakt_tokens from public, anon, authenticated;
grant select on public.trakt_tokens to service_role;
insert into public.trakt_tokens values ('00000000-0000-0000-0000-00000000000a', 'T0KEN-NOT-FOR-THE-BROWSER');

create table public.notes (id int primary key, user_id uuid not null, body text not null);
alter table public.notes enable row level security;
create policy notes_own on public.notes for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.notes to authenticated;
insert into public.notes values (1, '00000000-0000-0000-0000-00000000000a', 'the owner''s note: set up the gym plan'),
                                (2, '00000000-0000-0000-0000-00000000000b', 'someone else''s note');
create sequence public.t_seq;
grant usage on sequence public.t_seq to authenticated;

-- Helpers. A request as PostgREST makes it: signed in as authenticator, switched to the caller's role, the JWT's
-- claims set. t_ok raises on a mismatch; t_refused expects the read query to refuse with a given message.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
create or replace function public.t_refused(p_sql text, p_expect text, p_msg text) returns void language plpgsql as $$
declare
  v_err text;
  v_res jsonb;
  v_who text := current_user;
begin
  begin
    v_res := public.ai_run_read_query(p_sql);
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then raise exception 'FAIL  % — it ran and returned %', p_msg, left(coalesce(v_res::text, 'null'), 300); end if;
  if strpos(v_err, p_expect) = 0 then raise exception 'FAIL  % — refused with "%" instead of "%"', p_msg, v_err, p_expect; end if;
  if strpos(v_err, 'T0KEN') > 0 then raise exception 'FAIL  % — the refusal carried the token', p_msg; end if;
  if current_user <> v_who then raise exception 'FAIL  % — the caller was % and is now %', p_msg, v_who, current_user; end if;
  raise notice 'ok  %', p_msg;
end $$;
