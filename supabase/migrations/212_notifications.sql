-- 212 · Notifications (Phase 3 B1–B3; owner, 26.11.2026: "Notifications B1–B3", one PR — docs/features/notifications.md).
-- Builds on 211's `notifications` and keeps its security design: rows come only from the database (notify_row(), the
-- triggers below, the nightly job) and the service role; there is still no free-text and no URL column — the screen
-- and the push build the title and the way to the thing from the kind (src/features/notifications/notificationKinds.ts,
-- hand-mirrored into push-send). The browser reads its rows and sets read_at and acted_at, nothing else.
--
-- B1. notifications grows: more kinds (each with a fixed shape), `service` (a code from an allow-list, never text), `due_on`
--     (the day a sign-in or key ends), `acted_at` (the owner opened the thing from it) and `pushed_at` (the server's: when
--     a push carried it). notification_prefs: per account and kind, where it goes — in_app | push_now | push_morning |
--     push_weekly; no row = the kind's default (notification_default_channel, the same as the code registry —
--     verify-db-notifications compares them). notification_feed(): the bell's read, with the thing's name.
--     First producer: a followed film's new title or trailer (media_follow_events, 119) — only when the server wrote the
--     event (an allow-list of the server's roles: the browser can write that table, and a row it writes makes no notice). A
--     removed event takes its notice along. Film news has one "read": What's new's seen_at and the notice's read_at follow
--     each other both ways (the notice made unread again makes the event new again).
-- B2. A nightly job (notifications_daily) warns 14, 7 and 1 days before a PlayStation sign-in (psn_tokens.npsso_expires_at)
--     or the Claude API key (integration_expiry, typed by the owner) ends; the dedupe key holds the end day and the mark,
--     so each warning comes once and a renewed sign-in starts over. notify_service_problem(): the sync functions (Trakt,
--     Strava, Google, iCloud) and `claude` call it when the service rejects the stored sign-in or key — at most one per
--     service and Oslo day, and none while an unread one is there. Reconnecting settles it: a fresh sign-in written to
--     trakt_tokens, strava_tokens, user_calendar_tokens or icloud_credentials puts that service's failure notice away, and
--     `claude` calls notify_service_settle after a call Anthropic answered. integration_expiry keeps only the owner's dates and,
--     if typed, the key's last 4 characters: never the key.
-- B3. Delivery: notifications_claim / notifications_unclaim (push-send's, as 160's reminder claim); pg_cron
--     'lascis-notifications-push' every 15 minutes calls push-send {trigger: 'notifications'} only when a push_now item
--     waits; 'lascis-notifications-weekly' on Monday at 08:00 Oslo time sends the push_weekly digest; push_morning items
--     join the existing morning push (068's job, unchanged). The secret is PUSH_CRON_SECRET from Vault inside the job.
--
-- Security (AGENTS.md → the warning): every new input is checked where it enters — the kinds, services, channels, dates
-- and the key hint are allow-lists or bounded shapes; a dedupe key is built here, never taken from a caller. No row
-- carries a URL or a target for a write with outside credentials. SECURITY DEFINER only where a write the browser
-- can't make is needed (notify_row, the follow-event cleanup), each with search_path '' and every query scoped to the
-- row's own user; none is granted to the browser. Ask AI has no tool that reaches these tables.
-- No audit trigger on notifications (database-written bookkeeping, as 211); notification_prefs and integration_expiry
-- are the owner's and audited.

-- ── B1. notifications: kinds, shape, the new columns ─────────────────────────

alter table public.notifications add column if not exists service   text;
alter table public.notifications add column if not exists due_on    date;
alter table public.notifications add column if not exists acted_at  timestamptz;
alter table public.notifications add column if not exists pushed_at timestamptz;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'shop_bought_draft', 'follow_new_title', 'follow_trailer', 'sign_in_expiring', 'sign_in_failed',
  'claude_key_expiring', 'claude_key_rejected'));
alter table public.notifications drop constraint if exists notifications_link_kind_check;
alter table public.notifications add constraint notifications_link_kind_check check (link_kind in ('shop_item', 'media_follow_event'));
alter table public.notifications drop constraint if exists notifications_service_check;
alter table public.notifications add constraint notifications_service_check check (service in ('psn', 'trakt', 'strava', 'google', 'icloud', 'anthropic'));
-- Built only here: kind, then one to three parts of lower-case letters, digits, '_' or '-' (a uuid, a day, a service, a mark).
alter table public.notifications drop constraint if exists notifications_dedupe_key_check;
alter table public.notifications add constraint notifications_dedupe_key_check
  check (char_length(dedupe_key) <= 200 and dedupe_key ~ '^[a-z_]+(:[0-9a-z_-]{1,40}){1,3}$');
-- Each kind has one shape: what it links to, which service and whether it has an end day.
alter table public.notifications drop constraint if exists notifications_shape;
-- coalesce: a CHECK passes on null, so a missing link or service must read as false, never as unknown.
alter table public.notifications add constraint notifications_shape check (coalesce(case kind
  when 'shop_bought_draft'   then link_kind = 'shop_item' and service is null and due_on is null
  when 'follow_new_title'    then link_kind = 'media_follow_event' and service is null and due_on is null
  when 'follow_trailer'      then link_kind = 'media_follow_event' and service is null and due_on is null
  when 'sign_in_expiring'    then link_kind is null and service = 'psn' and due_on is not null
  when 'sign_in_failed'      then link_kind is null and service in ('trakt', 'strava', 'google', 'icloud') and due_on is null
  when 'claude_key_expiring' then link_kind is null and service = 'anthropic' and due_on is not null
  when 'claude_key_rejected' then link_kind is null and service = 'anthropic' and due_on is null
  else false end, false));

create index if not exists notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_unpushed on public.notifications (created_at) where read_at is null and pushed_at is null;

-- The browser marks read and acted, nothing else (211 granted read_at).
grant update (read_at, acted_at) on public.notifications to authenticated;
comment on table public.notifications is
  '211/212: server-written notices (kind + the thing by link kind and id, or a service code and end day; never a URL or free text). Written only by notify_row() (notify(), the triggers, the nightly job, notify_service_problem()); the browser reads them and sets read_at and acted_at; pushed_at is push-send''s.';

-- ── The one writer ───────────────────────────────────────────────────────────

-- One notice, once (its dedupe key). The constraints above refuse a wrong shape. Never granted to the browser.
create or replace function public.notify_row(p_user uuid, p_kind text, p_link_kind text, p_link_id uuid, p_service text,
                                             p_due_on date, p_dedupe text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then return null; end if;
  insert into public.notifications (user_id, kind, link_kind, link_id, service, due_on, dedupe_key)
  values (p_user, p_kind, p_link_kind, p_link_id, p_service, p_due_on, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.notify_row(uuid, text, text, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.notify_row(uuid, text, text, uuid, text, date, text) to service_role;

-- 211's door (the plan-effect trigger's): unchanged arguments, now through notify_row.
create or replace function public.notify(p_user uuid, p_kind text, p_link_kind text, p_link_id uuid, p_dedupe text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.notify_row(p_user, p_kind, p_link_kind, p_link_id, null, null, p_dedupe);
end
$$;
revoke all on function public.notify(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text, uuid, text) to service_role;

-- ── B1. Where each kind goes ─────────────────────────────────────────────────

create table if not exists public.notification_prefs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in (
               'shop_bought_draft', 'follow_new_title', 'follow_trailer', 'sign_in_expiring', 'sign_in_failed',
               'claude_key_expiring', 'claude_key_rejected')),
  channel    text not null check (channel in ('in_app', 'push_now', 'push_morning', 'push_weekly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_prefs_once unique (user_id, kind)
);
alter table public.notification_prefs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notification_prefs' and policyname = 'notification_prefs_own') then
    create policy notification_prefs_own on public.notification_prefs for all to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.notification_prefs to service_role;
comment on table public.notification_prefs is
  '212: where each kind of notice goes, per account (in_app, push_now, push_morning, push_weekly). No row = the kind''s default (notification_default_channel = notificationKinds.ts).';

-- The code registry's defaults (src/features/notifications/notificationKinds.ts; verify-db-notifications compares them).
create or replace function public.notification_default_channel(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'shop_bought_draft'   then 'in_app'
    when 'follow_new_title'    then 'push_weekly'
    when 'follow_trailer'      then 'in_app'
    when 'sign_in_expiring'    then 'push_morning'
    when 'sign_in_failed'      then 'push_now'
    when 'claude_key_expiring' then 'push_morning'
    when 'claude_key_rejected' then 'push_now'
    else 'in_app' end
$$;
revoke all on function public.notification_default_channel(text) from public, anon;
grant execute on function public.notification_default_channel(text) to authenticated, service_role;

create or replace function public.notification_channel(p_user uuid, p_kind text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select p.channel from public.notification_prefs p where p.user_id = p_user and p.kind = p_kind),
                  public.notification_default_channel(p_kind))
$$;
revoke all on function public.notification_channel(uuid, text) from public, anon;
grant execute on function public.notification_channel(uuid, text) to authenticated, service_role;

-- The thing's name (its own table, its own user's row; null when it is gone) and, for a film, its TMDB id.
create or replace function public.notification_subject(p_user uuid, p_link_kind text, p_link_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_link_kind
    when 'shop_item' then (select s.title from public.shop_items s where s.id = p_link_id and s.user_id = p_user)
    when 'media_follow_event' then (select e.title from public.media_follow_events e where e.id = p_link_id and e.user_id = p_user)
  end
$$;
revoke all on function public.notification_subject(uuid, text, uuid) from public, anon;
grant execute on function public.notification_subject(uuid, text, uuid) to authenticated, service_role;

-- The bell's and the page's read: the caller's own notices, newest first, with the thing's name. SECURITY INVOKER:
-- row level security decides what it reads (the name lookups too).
create or replace function public.notification_feed(p_limit integer default 30, p_before timestamptz default null,
                                                    p_unread_only boolean default false)
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
   order by n.created_at desc, n.id
   limit least(greatest(coalesce(p_limit, 30), 1), 200)
$$;
revoke all on function public.notification_feed(integer, timestamptz, boolean) from public, anon;
grant execute on function public.notification_feed(integer, timestamptz, boolean) to authenticated, service_role;

-- ── B1. First producer: a followed film's news ───────────────────────────────

-- Only an event the server wrote (trakt-api's follow check, the service role) becomes a notice: the browser can write
-- media_follow_events (119's policy), and a row it writes must not make one. An allow-list of the server's roles (guardian,
-- 26.11.2026: a role added later is refused until named here). SECURITY INVOKER, so current_user is the writer;
-- notify_row is the service role's.
create or replace function public.media_follow_events_notify()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then return null; end if;
  perform public.notify_row(new.user_id, case new.kind when 'trailer' then 'follow_trailer' else 'follow_new_title' end,
                            'media_follow_event', new.id, null, null, 'follow:' || new.id::text);
  return null;
end
$$;
revoke all on function public.media_follow_events_notify() from public, anon, authenticated;
drop trigger if exists trg_media_follow_events_notify on public.media_follow_events;
create trigger trg_media_follow_events_notify
  after insert on public.media_follow_events
  for each row execute function public.media_follow_events_notify();

-- A removed event (the follow check's clean-up, an unfollow's cascade, the owner) takes its notice along.
create or replace function public.media_follow_events_unnotify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.user_id = old.user_id and n.link_kind = 'media_follow_event' and n.link_id = old.id;
  return null;
end
$$;
revoke all on function public.media_follow_events_unnotify() from public, anon, authenticated;
drop trigger if exists trg_media_follow_events_unnotify on public.media_follow_events;
create trigger trg_media_follow_events_unnotify
  after delete on public.media_follow_events
  for each row execute function public.media_follow_events_unnotify();

-- One "read" for film news (owner-critic, 26.11.2026): What's new's seen_at and the notice's read_at follow each other.
-- An event marked seen (Media → Lists) puts its notice away (read). SECURITY INVOKER: the browser may set read_at on its
-- own notices; the query names the event's own user.
create or replace function public.media_follow_events_seen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.seen_at is not null and old.seen_at is null then
    update public.notifications n set read_at = new.seen_at
     where n.user_id = new.user_id and n.link_kind = 'media_follow_event' and n.link_id = new.id and n.read_at is null;
  end if;
  return null;
end
$$;
revoke all on function public.media_follow_events_seen() from public, anon, authenticated;
drop trigger if exists trg_media_follow_events_seen on public.media_follow_events;
create trigger trg_media_follow_events_seen
  after update of seen_at on public.media_follow_events
  for each row execute function public.media_follow_events_seen();

-- A film notice read (or opened) marks its event seen; made unread again (its Undo), the event is new again. A trigger
-- function (never callable on its own), SECURITY DEFINER so it works whatever the browser's rights on the events are:
-- it touches only the one event the notice links to, and only the notice's own user's.
create or replace function public.notifications_follow_seen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.link_kind is distinct from 'media_follow_event' or new.link_id is null then return null; end if;
  if new.read_at is not null and old.read_at is null then
    update public.media_follow_events e set seen_at = new.read_at
     where e.id = new.link_id and e.user_id = new.user_id and e.seen_at is null;
  elsif new.read_at is null and old.read_at is not null then
    update public.media_follow_events e set seen_at = null
     where e.id = new.link_id and e.user_id = new.user_id and e.seen_at is not null;
  end if;
  return null;
end
$$;
revoke all on function public.notifications_follow_seen() from public, anon, authenticated;
drop trigger if exists trg_notifications_follow_seen on public.notifications;
create trigger trg_notifications_follow_seen
  after update of read_at on public.notifications
  for each row execute function public.notifications_follow_seen();

-- ── B2. The owner's dates for a key the app can't read ───────────────────────

create table if not exists public.integration_expiry (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  service        text not null check (service in ('anthropic')),
  starts_on      date not null check (starts_on between date '2000-01-01' and date '2100-01-01'),
  duration_count integer not null,
  duration_unit  text not null check (duration_unit in ('days', 'months')),
  ends_on        date not null,
  key_hint       text check (key_hint is null or key_hint ~ '^[A-Za-z0-9_-]{4}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint integration_expiry_duration check ((duration_unit = 'days' and duration_count between 1 and 3650)
                                             or (duration_unit = 'months' and duration_count between 1 and 120)),
  constraint integration_expiry_once unique (user_id, service)
);
alter table public.integration_expiry enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'integration_expiry' and policyname = 'integration_expiry_own') then
    create policy integration_expiry_own on public.integration_expiry for all to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
revoke all on public.integration_expiry from anon, authenticated;
grant select, insert, update, delete on public.integration_expiry to authenticated;
grant select, insert, update, delete on public.integration_expiry to service_role;
comment on table public.integration_expiry is
  '212: when a key the app can''t read ends, as the owner typed it (start day + duration; ends_on is worked out here) and, if typed, its last 4 characters. Never the key.';

-- The end day is the database's (a writer's ends_on is replaced): a start day plus days, or plus months as Postgres
-- adds them (31.01 + 1 month = the last day of February) — keyExpiry.ts shows the same before the save.
create or replace function public.integration_expiry_fill()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.ends_on := case new.duration_unit
    when 'days' then new.starts_on + new.duration_count
    else (new.starts_on + make_interval(months => new.duration_count))::date end;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function public.integration_expiry_fill() from public, anon, authenticated;
drop trigger if exists trg_integration_expiry_fill on public.integration_expiry;
create trigger trg_integration_expiry_fill
  before insert or update on public.integration_expiry
  for each row execute function public.integration_expiry_fill();

-- A new end day puts the warnings about the old one away (read), so the bell never says an old date. SECURITY INVOKER:
-- the browser may set read_at on its own notices (and psn_tokens is the service role's).
create or replace function public.expiry_warnings_settle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_psn  boolean := tg_table_name = 'psn_tokens';
  v_kind text := case when tg_table_name = 'psn_tokens' then 'sign_in_expiring' else 'claude_key_expiring' end;
  v_new  jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old  jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_due  date;
  v_was  date;
begin
  -- Read through jsonb: the two tables name their end differently. (An UPDATE OF column trigger would miss ends_on:
  -- the BEFORE trigger sets it, not the writer's SET list.)
  v_due := case when v_psn then ((v_new ->> 'npsso_expires_at')::timestamptz at time zone 'Europe/Oslo')::date
                else (v_new ->> 'ends_on')::date end;
  v_was := case when v_psn then ((v_old ->> 'npsso_expires_at')::timestamptz at time zone 'Europe/Oslo')::date
                else (v_old ->> 'ends_on')::date end;
  if tg_op = 'UPDATE' and v_due is not distinct from v_was then return null; end if;
  update public.notifications n set read_at = now()
   where n.user_id = coalesce((v_new ->> 'user_id')::uuid, (v_old ->> 'user_id')::uuid)
     and n.kind = v_kind and n.read_at is null and n.due_on is distinct from v_due;
  return null;
end
$$;
revoke all on function public.expiry_warnings_settle() from public, anon, authenticated;
drop trigger if exists trg_integration_expiry_settle on public.integration_expiry;
create trigger trg_integration_expiry_settle
  after insert or update or delete on public.integration_expiry
  for each row execute function public.expiry_warnings_settle();
drop trigger if exists trg_psn_tokens_expiry_settle on public.psn_tokens;
create trigger trg_psn_tokens_expiry_settle
  after insert or update or delete on public.psn_tokens
  for each row execute function public.expiry_warnings_settle();

-- ── B2. The nightly warnings ─────────────────────────────────────────────────

-- The mark a day count falls under (14, 7 or 1), or null outside the 14 days (or once the day has passed).
create or replace function public.expiry_mark(p_days integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_days is null or p_days < 0 or p_days > 14 then null
              when p_days <= 1 then 1 when p_days <= 7 then 7 else 14 end
$$;
revoke all on function public.expiry_mark(integer) from public, anon;
grant execute on function public.expiry_mark(integer) to authenticated, service_role;

-- Every account's sign-ins and keys that end within 14 days: one notice per end day and mark (a missed night gives the
-- current mark only, never a burst). Days are Oslo's. Returns how many notices it wrote.
create or replace function public.notifications_daily(p_now timestamptz default now())
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Oslo')::date;
  v_n     integer := 0;
  r       record;
begin
  for r in
    select t.user_id, (t.npsso_expires_at at time zone 'Europe/Oslo')::date as due
      from public.psn_tokens t
     where t.npsso_expires_at is not null
       and public.expiry_mark(((t.npsso_expires_at at time zone 'Europe/Oslo')::date - v_today)) is not null
  loop
    if public.notify_row(r.user_id, 'sign_in_expiring', null, null, 'psn', r.due,
         'sign_in_expiring:psn:' || to_char(r.due, 'YYYY-MM-DD') || ':' || public.expiry_mark(r.due - v_today)) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  for r in
    select x.user_id, x.ends_on as due
      from public.integration_expiry x
     where x.service = 'anthropic' and public.expiry_mark(x.ends_on - v_today) is not null
  loop
    if public.notify_row(r.user_id, 'claude_key_expiring', null, null, 'anthropic', r.due,
         'claude_key_expiring:' || to_char(r.due, 'YYYY-MM-DD') || ':' || public.expiry_mark(r.due - v_today)) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
revoke all on function public.notifications_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.notifications_daily(timestamptz) to service_role;

-- ── B2. A service rejected the stored sign-in or key ─────────────────────────

-- Called by trakt-api, strava-activities, google-tasks-sync, calendar-token, icloud-calendar and claude (the service
-- role) when the service refuses the stored sign-in or key. The service is an allow-list; the dedupe key is built here:
-- one per service and Oslo day, and none while an unread one about it is there.
create or replace function public.notify_service_problem(p_user uuid, p_service text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
begin
  if p_service not in ('trakt', 'strava', 'google', 'icloud', 'anthropic') then
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

-- Reconnecting settles the failure: a fresh sign-in written for Trakt, Strava, Google or Apple Calendar (a connect, or a
-- refresh that worked) puts that service's unread "sign in again" notice away. SECURITY INVOKER: these tables are the
-- service role's.
create or replace function public.sign_in_settle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_service text := case tg_table_name when 'trakt_tokens' then 'trakt' when 'strava_tokens' then 'strava'
                      when 'user_calendar_tokens' then 'google' when 'icloud_credentials' then 'icloud' end;
begin
  if v_service is null then return null; end if;
  update public.notifications n set read_at = now()
   where n.user_id = new.user_id and n.service = v_service and n.read_at is null and n.kind = 'sign_in_failed';
  return null;
end
$$;
revoke all on function public.sign_in_settle() from public, anon, authenticated;
drop trigger if exists trg_trakt_tokens_settle on public.trakt_tokens;
create trigger trg_trakt_tokens_settle after insert or update of refresh_token on public.trakt_tokens
  for each row execute function public.sign_in_settle();
drop trigger if exists trg_strava_tokens_settle on public.strava_tokens;
create trigger trg_strava_tokens_settle after insert or update of refresh_token on public.strava_tokens
  for each row execute function public.sign_in_settle();
drop trigger if exists trg_user_calendar_tokens_settle on public.user_calendar_tokens;
create trigger trg_user_calendar_tokens_settle after insert or update of refresh_token on public.user_calendar_tokens
  for each row execute function public.sign_in_settle();
drop trigger if exists trg_icloud_credentials_settle on public.icloud_credentials;
create trigger trg_icloud_credentials_settle after insert or update of app_password on public.icloud_credentials
  for each row execute function public.sign_in_settle();
-- Anthropic answering again: `claude` calls this after a call that went well (never a trigger on the ledger, 194's rule).
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
       and p_service in ('trakt', 'strava', 'google', 'icloud', 'anthropic') and n.service = p_service
       and n.kind = case p_service when 'anthropic' then 'claude_key_rejected' else 'sign_in_failed' end
    returning 1)
  select count(*)::integer from settled
$$;
revoke all on function public.notify_service_settle(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_service_settle(uuid, text) to service_role;

-- ── B3. Delivery (push-send's) ───────────────────────────────────────────────

-- How long a notice may wait for its push: a push_now or morning one within 2 days, a weekly one within 8.
create or replace function public.notification_push_window(p_channel text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_channel when 'push_weekly' then interval '8 days' else interval '2 days' end
$$;
revoke all on function public.notification_push_window(text) from public, anon;
grant execute on function public.notification_push_window(text) to service_role;

-- Is a push of this channel waiting for any account? (The cron jobs call push-send only then.)
create or replace function public.notifications_push_due(p_channel text, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.notifications n
     where n.read_at is null and n.pushed_at is null
       and n.created_at > p_now - public.notification_push_window(p_channel) and n.created_at <= p_now
       and public.notification_channel(n.user_id, n.kind) = p_channel)
$$;
revoke all on function public.notifications_push_due(text, timestamptz) from public, anon, authenticated;
grant execute on function public.notifications_push_due(text, timestamptz) to service_role;

-- The unread notices of a channel not pushed yet, stamped with p_now (one run at a time: a second run skips the rows
-- the first holds). push-send puts the stamp back when no device took the push.
create or replace function public.notifications_claim(p_user uuid, p_channel text, p_now timestamptz)
returns table (id uuid, kind text, link_kind text, link_id uuid, service text, due_on date, created_at timestamptz,
               subject text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_channel not in ('push_now', 'push_morning', 'push_weekly') then
    raise exception 'notifications_claim: unknown channel' using errcode = '22023';
  end if;
  return query
  with due as (
    select n.id from public.notifications n
     where n.user_id = p_user and n.read_at is null and n.pushed_at is null
       and n.created_at > p_now - public.notification_push_window(p_channel) and n.created_at <= p_now
       and public.notification_channel(n.user_id, n.kind) = p_channel
     order by n.created_at
     limit 50
     for update skip locked
  ), stamped as (
    update public.notifications n set pushed_at = p_now
      from due where n.id = due.id and n.user_id = p_user
    returning n.id, n.kind, n.link_kind, n.link_id, n.service, n.due_on, n.created_at, n.user_id
  )
  select s.id, s.kind, s.link_kind, s.link_id, s.service, s.due_on, s.created_at,
         public.notification_subject(s.user_id, s.link_kind, s.link_id)
    from stamped s order by s.created_at;
end
$$;
revoke all on function public.notifications_claim(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.notifications_claim(uuid, text, timestamptz) to service_role;

create or replace function public.notifications_unclaim(p_user uuid, p_ids uuid[], p_stamp timestamptz)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with back as (
    update public.notifications n set pushed_at = null
     where n.user_id = p_user and n.id = any (p_ids) and n.pushed_at = p_stamp
    returning 1)
  select count(*)::integer from back
$$;
revoke all on function public.notifications_unclaim(uuid, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.notifications_unclaim(uuid, uuid[], timestamptz) to service_role;

-- ── B2/B3. The timers (pg_cron, UTC; the secret from Vault inside the job, 068's pattern) ──

-- 05:40 UTC: the warnings are written before the morning push (07:00 UTC) can carry them.
select cron.unschedule('lascis-notifications-daily')
 where exists (select 1 from cron.job where jobname = 'lascis-notifications-daily');
select cron.schedule('lascis-notifications-daily', '40 5 * * *', $cron$
  select public.notifications_daily(now());
$cron$);

-- Every 15 minutes; push-send is called only when a push_now notice waits, so a quiet day makes no request.
select cron.unschedule('lascis-notifications-push')
 where exists (select 1 from cron.job where jobname = 'lascis-notifications-push');
select cron.schedule('lascis-notifications-push', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PUSH_CRON_SECRET'), '')
    ),
    body := jsonb_build_object('trigger', 'notifications')
  )
  where public.notifications_push_due('push_now', now());
$cron$);

-- Monday 08:00 in Oslo: pg_cron runs in UTC, so the job wakes at 06:00 and 07:00 UTC and goes on only in the hour that
-- is 08 in Oslo (winter or summer time).
select cron.unschedule('lascis-notifications-weekly')
 where exists (select 1 from cron.job where jobname = 'lascis-notifications-weekly');
select cron.schedule('lascis-notifications-weekly', '0 6,7 * * 1', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PUSH_CRON_SECRET'), '')
    ),
    body := jsonb_build_object('trigger', 'notifications', 'digest', 'weekly')
  )
  where extract(hour from (now() at time zone 'Europe/Oslo')) = 8
    and public.notifications_push_due('push_weekly', now());
$cron$);

-- ── Audit, owner lock ────────────────────────────────────────────────────────

drop trigger if exists trg_audit on public.notification_prefs;
create trigger trg_audit after insert or update or delete on public.notification_prefs
  for each row execute function public.log_audit();
drop trigger if exists trg_audit on public.integration_expiry;
create trigger trg_audit after insert or update or delete on public.integration_expiry
  for each row execute function public.log_audit();

select public.owner_lock_apply('public.notification_prefs');
select public.owner_lock_apply('public.integration_expiry');

do $$
begin
  if to_regclass('public.notification_prefs') is null or to_regclass('public.integration_expiry') is null then
    raise exception 'Migration 212 assertion failed: a notifications table is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications'
                  and column_name = 'acted_at') then
    raise exception 'Migration 212 assertion failed: notifications.acted_at is missing';
  end if;
end $$;
