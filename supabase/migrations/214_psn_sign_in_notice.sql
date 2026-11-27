-- 214 · PlayStation's refused sign-in becomes a notice, and the feed reads chosen kinds (owner, 27.11.2026:
-- "PlayStation: should it also tell you when its sign-in fails?" — "yes"; "Shop → Needs a look: should it show the same
-- notices list as the bell, instead of its own?" — "yes"; docs/features/notifications.md).
--
-- 1. `psn` joins the services a sign-in can fail for: notifications_shape's sign_in_failed, notify_service_problem's and
--    notify_service_settle's allow-lists. psn-api calls notify_service_problem(user, 'psn') when Sony's token endpoint
--    refuses the stored refresh token (it answers without an access token: the npsso has to be pasted again).
-- 2. A fresh PlayStation sign-in settles it: sign_in_settle() learns psn_tokens, and a trigger on psn_tokens (a connect,
--    or a refresh that worked — both write refresh_token) reads that account's unread "PlayStation needs you to sign in
--    again", as 212 does for Trakt, Strava, Google and Apple Calendar.
-- 3. notification_feed() takes an optional list of kinds (Shop's Needs a look shows the bell's list, filtered to the
--    Shop's kinds). A new argument can't be added with `create or replace`: the three-argument function is dropped and
--    made again with the same rights (two would make PostgREST's call ambiguous). The website before this sends no kinds
--    and is answered by the new function's default.
--
-- Security (what an attacker controlling each input could do): psn_tokens is the service role's (140 revoked the browser),
-- so only psn-api's own writes fire the settle trigger; a forged write there could at worst read the owner's own
-- PlayStation failure notice early — never write, re-point or delete a notice, and never another account's (the update
-- is scoped to the written row's user_id). The settle is SECURITY INVOKER, search_path ''. The new service code is one
-- more value of an allow-list; the dedupe key is still built in SQL. The feed's kinds only narrow the caller's own rows
-- (SECURITY INVOKER, row level security); an unknown kind matches nothing.

-- ── 1. psn in the allow-lists ────────────────────────────────────────────────

alter table public.notifications drop constraint if exists notifications_shape;
-- coalesce: a CHECK passes on null, so a missing link or service must read as false, never as unknown.
alter table public.notifications add constraint notifications_shape check (coalesce(case kind
  when 'shop_bought_draft'   then link_kind = 'shop_item' and service is null and due_on is null
  when 'follow_new_title'    then link_kind = 'media_follow_event' and service is null and due_on is null
  when 'follow_trailer'      then link_kind = 'media_follow_event' and service is null and due_on is null
  when 'sign_in_expiring'    then link_kind is null and service = 'psn' and due_on is not null
  when 'sign_in_failed'      then link_kind is null and service in ('psn', 'trakt', 'strava', 'google', 'icloud') and due_on is null
  when 'claude_key_expiring' then link_kind is null and service = 'anthropic' and due_on is not null
  when 'claude_key_rejected' then link_kind is null and service = 'anthropic' and due_on is null
  else false end, false));

-- Called by trakt-api, strava-activities, google-tasks-sync, calendar-token, icloud-calendar, psn-api and claude (the
-- service role) when the service refuses the stored sign-in or key. The service is an allow-list; the dedupe key is
-- built here: one per service and Oslo day, and none while an unread one about it is there.
create or replace function public.notify_service_problem(p_user uuid, p_service text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
begin
  if p_service not in ('psn', 'trakt', 'strava', 'google', 'icloud', 'anthropic') then
    raise exception 'notify_service_problem: unknown service' using errcode = '22023';
  end if;
  v_kind := case p_service when 'anthropic' then 'claude_key_rejected' else 'sign_in_failed' end;
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.kind = v_kind and n.service = p_service and n.read_at is null) then
    return null;
  end if;
  return public.notify_row(p_user, v_kind, null, null, p_service, null,
    v_kind || ':' || p_service || ':' || to_char((now() at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD'));
end
$$;
revoke all on function public.notify_service_problem(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_service_problem(uuid, text) to service_role;

-- The service is an allow-list; only that account's unread failure notice of the service is put away.
create or replace function public.notify_service_settle(p_user uuid, p_service text)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with settled as (
    update public.notifications n set read_at = now()
     where n.user_id = p_user and n.read_at is null
       and p_service in ('psn', 'trakt', 'strava', 'google', 'icloud', 'anthropic') and n.service = p_service
       and n.kind = case p_service when 'anthropic' then 'claude_key_rejected' else 'sign_in_failed' end
    returning 1)
  select count(*)::integer from settled
$$;
revoke all on function public.notify_service_settle(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_service_settle(uuid, text) to service_role;

-- ── 2. A fresh PlayStation sign-in settles it ────────────────────────────────

-- Reconnecting settles the failure: a fresh sign-in written for Trakt, Strava, Google, Apple Calendar or PlayStation (a
-- connect, or a refresh that worked) puts that service's unread "sign in again" notice away. SECURITY INVOKER: these
-- tables are the service role's.
create or replace function public.sign_in_settle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_service text := case tg_table_name when 'trakt_tokens' then 'trakt' when 'strava_tokens' then 'strava'
                      when 'user_calendar_tokens' then 'google' when 'icloud_credentials' then 'icloud'
                      when 'psn_tokens' then 'psn' end;
begin
  if v_service is null then return null; end if;
  update public.notifications n set read_at = now()
   where n.user_id = new.user_id and n.service = v_service and n.read_at is null and n.kind = 'sign_in_failed';
  return null;
end
$$;
revoke all on function public.sign_in_settle() from public, anon, authenticated;
-- psn-api writes refresh_token on a connect (the upsert) and on every refresh that worked; a refused refresh writes nothing.
drop trigger if exists trg_psn_tokens_settle on public.psn_tokens;
create trigger trg_psn_tokens_settle after insert or update of refresh_token on public.psn_tokens
  for each row execute function public.sign_in_settle();

-- ── 3. The feed reads chosen kinds ───────────────────────────────────────────

-- The bell's, the page's and Shop's read: the caller's own notices, newest first, with the thing's name; `p_kinds` (null:
-- every kind) narrows them. SECURITY INVOKER: row level security decides what it reads (the name lookups too).
drop function if exists public.notification_feed(integer, timestamptz, boolean);
create or replace function public.notification_feed(p_limit integer default 30, p_before timestamptz default null,
                                                    p_unread_only boolean default false, p_kinds text[] default null)
returns table (id uuid, kind text, link_kind text, link_id uuid, service text, due_on date, created_at timestamptz,
               read_at timestamptz, acted_at timestamptz, subject text, subject_tmdb integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select n.id, n.kind, n.link_kind, n.link_id, n.service, n.due_on, n.created_at, n.read_at, n.acted_at,
         public.notification_subject(n.user_id, n.link_kind, n.link_id),
         case when n.link_kind = 'media_follow_event'
              then (select e.tmdb_id from public.media_follow_events e where e.id = n.link_id and e.user_id = n.user_id) end
    from public.notifications n
   where n.user_id = (select auth.uid())
     and (p_before is null or n.created_at < p_before)
     and (not coalesce(p_unread_only, false) or n.read_at is null)
     and (p_kinds is null or n.kind = any (p_kinds))
   order by n.created_at desc, n.id
   limit least(greatest(coalesce(p_limit, 30), 1), 200)
$$;
revoke all on function public.notification_feed(integer, timestamptz, boolean, text[]) from public, anon;
grant execute on function public.notification_feed(integer, timestamptz, boolean, text[]) to authenticated, service_role;
