-- Migrations 212 (notifications, Phase 3 B1–B3) and 213 (PlayStation's refused sign-in, the feed's kinds) after each ran
-- twice (scripts/verify-db-notifications.mjs), on 211's
-- notifications section, psn_tokens (091/101), media follows (119) and the stand-ins of notifications/seed.sql. Setup and
-- checks run as the superuser (the service role's stand-in: a writer without row security); app reads and writes run
-- as `authenticated` (test.uid picks the caller: unset = the owner, user 2 = another allowed account, user 3 = an
-- account the owner lock refuses).
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'written';
exception when others then
  return sqlstate;
end $$;
grant execute on function public.t_refused(text) to authenticated;
create table public.t_keep (k text primary key, v text);
grant all on public.t_keep to authenticated;

-- ── The migration and its timers ─────────────────────────────────────────────
select public.t_ok((select count(*) from cron.job where jobname in ('lascis-notifications-daily', 'lascis-notifications-push', 'lascis-notifications-weekly')) = 3,
  'two runs leave each of the three timers once');
select public.t_ok((select schedule from cron.job where jobname = 'lascis-notifications-push') = '*/15 * * * *'
  and (select schedule from cron.job where jobname = 'lascis-notifications-weekly') = '0 6,7 * * 1'
  and (select command from cron.job where jobname = 'lascis-notifications-weekly') like '%Europe/Oslo%= 8%',
  'push every 15 minutes; the weekly digest wakes at 06 and 07 UTC on Monday and goes on only at 08 in Oslo');
select public.t_ok((select command from cron.job where jobname = 'lascis-notifications-push') like '%vault.decrypted_secrets%'
  and (select command from cron.job where jobname = 'lascis-notifications-push') not like '%test-cron-secret%',
  'the push timer reads its secret from Vault at call time, never inline');

-- ── 211's door still works, through notify_row ───────────────────────────────
insert into public.shop_items (id, user_id, title) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Rain jacket'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Not yours');
select public.t_ok(public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', 'shop_item',
  '30000000-0000-0000-0000-000000000001', 'shop_bought:90000000-0000-0000-0000-000000000001') is not null, '211''s notify() still writes a Shop notice');
select public.t_ok(public.notify('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', 'shop_item',
  '30000000-0000-0000-0000-000000000001', 'shop_bought:90000000-0000-0000-0000-000000000001') is null, 'the same dedupe key adds nothing');

-- ── Each kind has one shape ──────────────────────────────────────────────────
select public.t_ok(public.t_refused($q$select public.notify_row('00000000-0000-0000-0000-000000000001', 'sign_in_failed', null, null, null, null, 'sign_in_failed:x:2026-11-26')$q$) = '23514',
  'a sign-in notice without its service is refused');
select public.t_ok(public.t_refused($q$select public.notify_row('00000000-0000-0000-0000-000000000001', 'sign_in_failed', null, null, 'anthropic', null, 'sign_in_failed:anthropic:2026-11-26')$q$) = '23514',
  'a sign-in failure for the Claude key is refused (the key has its own kind)');
select public.t_ok(public.t_refused($q$select public.notify_row('00000000-0000-0000-0000-000000000001', 'shop_bought_draft', null, null, null, null, 'shop_bought:a')$q$) = '23514',
  'a Shop notice without its thing is refused');
select public.t_ok(public.t_refused($q$select public.notify_row('00000000-0000-0000-0000-000000000001', 'sign_in_failed', null, null, 'evil.example', null, 'sign_in_failed:x:1')$q$) = '23514',
  'a service outside the allow-list is refused');
select public.t_ok(public.t_refused($q$select public.notify_row('00000000-0000-0000-0000-000000000001', 'claude_key_rejected', null, null, 'anthropic', null, 'claude_key_rejected:https://x')$q$) = '23514',
  'a dedupe key with a URL in it is refused');
select public.t_ok(public.t_refused($q$select public.notify_row('00000000-0000-0000-0000-000000000001', 'phishing', null, null, null, null, 'phishing:a')$q$) = '23514',
  'an unknown kind is refused');
select public.t_ok(public.notify_row('00000000-0000-0000-0000-0000000000ff', 'claude_key_rejected', null, null, 'anthropic', null, 'claude_key_rejected:x') is null,
  'an account that does not exist gets nothing (and nothing fails)');
select public.t_ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications'
  and data_type = 'text' and column_name not in ('kind', 'link_kind', 'dedupe_key', 'service')),
  'notifications still has no free-text or URL column');

-- ── The browser reads its own and sets read_at and acted_at only ─────────────
set role authenticated;
select public.t_ok((select count(*) from public.notifications) = 1, 'the owner reads their notice');
select public.t_ok(public.t_refused($q$update public.notifications set read_at = now(), acted_at = now()$q$) = 'written', 'the owner marks it read and acted');
select public.t_ok(public.t_refused($q$update public.notifications set kind = 'sign_in_failed'$q$) = '42501', 'the owner cannot change its kind');
select public.t_ok(public.t_refused($q$update public.notifications set pushed_at = now()$q$) = '42501', 'the owner cannot stamp it pushed');
select public.t_ok(public.t_refused($q$update public.notifications set link_id = gen_random_uuid()$q$) = '42501', 'the owner cannot point it elsewhere');
select public.t_ok(public.t_refused($q$insert into public.notifications (kind, link_kind, link_id, dedupe_key) values ('shop_bought_draft', 'shop_item', gen_random_uuid(), 'shop_bought:x')$q$) = '42501',
  'the browser cannot write a notice');
select public.t_ok(public.t_refused($q$delete from public.notifications$q$) = '42501', 'the browser cannot delete a notice');
select public.t_ok(public.t_refused($q$select public.notify_row(auth.uid(), 'claude_key_rejected', null, null, 'anthropic', null, 'claude_key_rejected:x')$q$) = '42501',
  'the browser cannot call notify_row');
select public.t_ok(public.t_refused($q$select public.notify_service_problem(auth.uid(), 'trakt')$q$) = '42501', 'nor notify_service_problem');
select public.t_ok(public.t_refused($q$select public.notifications_daily(now())$q$) = '42501', 'nor the nightly job');
select public.t_ok(public.t_refused($q$select * from public.notifications_claim(auth.uid(), 'push_now', now())$q$) = '42501', 'nor the push claim');
set test.uid = '00000000-0000-0000-0000-000000000002';
select public.t_ok((select count(*) from public.notifications) = 0, 'another account reads none of the owner''s notices');
select public.t_ok((select count(*) from public.notification_feed(30, null, false)) = 0, 'nor through the feed');
reset test.uid;
reset role;
update public.notifications set read_at = null, acted_at = null;

-- ── First producer: a followed film's news, only from the server ─────────────
insert into public.media_follows (id, user_id, kind, tmdb_id, name) values
  ('11900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'director', 1, 'A director');
insert into public.media_follow_events (id, user_id, follow_id, kind, tmdb_id, title) values
  ('11900000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', '11900000-0000-0000-0000-000000000001', 'new_title', 4242, 'A New Film'),
  ('11900000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', '11900000-0000-0000-0000-000000000001', 'trailer', 4243, 'A Trailer Film');
select public.t_ok((select count(*) from public.notifications where kind = 'follow_new_title' and link_id = '11900000-0000-0000-0000-0000000000e1'
  and dedupe_key = 'follow:11900000-0000-0000-0000-0000000000e1') = 1, 'a new film the server found is a notice');
select public.t_ok((select count(*) from public.notifications where kind = 'follow_trailer' and link_id = '11900000-0000-0000-0000-0000000000e2') = 1,
  'a new trailer is its own kind');
set role authenticated;
insert into public.media_follow_events (id, follow_id, kind, tmdb_id, title) values
  ('11900000-0000-0000-0000-0000000000e3', '11900000-0000-0000-0000-000000000001', 'new_title', 1, 'Forged: sign in at evil.example');
select public.t_ok((select count(*) from public.notifications where link_id = '11900000-0000-0000-0000-0000000000e3') = 0,
  'an event the browser writes makes no notice');
select public.t_ok((select subject from public.notification_feed(30, null, false) where link_id = '11900000-0000-0000-0000-0000000000e1') = 'A New Film'
  and (select subject_tmdb from public.notification_feed(30, null, false) where link_id = '11900000-0000-0000-0000-0000000000e1') = 4242,
  'the feed names the film and its TMDB id');
select public.t_ok((select subject from public.notification_feed(30, null, false) where kind = 'shop_bought_draft') = 'Rain jacket',
  'the feed names the Shop thing');
delete from public.media_follow_events where id = '11900000-0000-0000-0000-0000000000e2';
reset role;
select public.t_ok((select count(*) from public.notifications where link_id = '11900000-0000-0000-0000-0000000000e2') = 0,
  'a removed event takes its notice along (the browser could not delete it itself)');
delete from public.media_follows where id = '11900000-0000-0000-0000-000000000001';
select public.t_ok((select count(*) from public.notifications where link_kind = 'media_follow_event') = 0,
  'unfollowing removes the follow''s notices with its events');

-- ── Where each kind goes ─────────────────────────────────────────────────────
select public.t_ok(public.notification_channel('00000000-0000-0000-0000-000000000001', 'sign_in_failed') = 'push_now'
  and public.notification_channel('00000000-0000-0000-0000-000000000001', 'shop_bought_draft') = 'in_app', 'no row: the kind''s default');
set role authenticated;
insert into public.notification_prefs (kind, channel) values ('shop_bought_draft', 'push_now');
select public.t_ok(public.notification_channel(auth.uid(), 'shop_bought_draft') = 'push_now', 'the owner''s choice wins');
select public.t_ok(public.t_refused($q$insert into public.notification_prefs (kind, channel) values ('sign_in_failed', 'sms')$q$) = '23514', 'an unknown channel is refused');
select public.t_ok(public.t_refused($q$insert into public.notification_prefs (kind, channel) values ('shop_bought_draft', 'in_app')$q$) = '23505', 'one choice per kind');
select public.t_ok(public.t_refused($q$insert into public.notification_prefs (user_id, kind, channel) values ('00000000-0000-0000-0000-000000000002', 'sign_in_failed', 'in_app')$q$) = '42501',
  'a choice for another account is refused');
set test.uid = '00000000-0000-0000-0000-000000000002';
select public.t_ok((select count(*) from public.notification_prefs) = 0, 'another account reads none of the owner''s choices');
set test.uid = '00000000-0000-0000-0000-000000000003';
select public.t_ok(public.t_refused($q$insert into public.notification_prefs (kind, channel) values ('sign_in_failed', 'in_app')$q$) = '42501',
  'an account outside the owner lock cannot write a choice');
reset test.uid;
delete from public.notification_prefs where kind = 'shop_bought_draft';
reset role;
select public.t_ok((select count(*) from public.audit_logs where table_name = 'notification_prefs') = 2, 'choices are audited');

-- ── The Claude key's dates ───────────────────────────────────────────────────
set role authenticated;
insert into public.integration_expiry (service, starts_on, duration_count, duration_unit, ends_on, key_hint)
values ('anthropic', '2026-01-31', 1, 'months', '2099-01-01', 'Ab3_');
select public.t_ok((select ends_on from public.integration_expiry) = '2026-02-28', 'one month from 31.01.2026 ends 28.02.2026; a writer''s own end day is replaced');
update public.integration_expiry set duration_count = 90, duration_unit = 'days';
select public.t_ok((select ends_on from public.integration_expiry) = '2026-05-01', '90 days from 31.01.2026 end 01.05.2026');
update public.integration_expiry set starts_on = '2028-01-31', duration_count = 1, duration_unit = 'months';
select public.t_ok((select ends_on from public.integration_expiry) = '2028-02-29', 'a leap year''s February has its 29th');
select public.t_ok(public.t_refused($q$update public.integration_expiry set key_hint = 'sk-ant-api03-whole-key'$q$) = '23514', 'only 4 characters of the key fit');
select public.t_ok(public.t_refused($q$update public.integration_expiry set duration_count = 121$q$) = '23514', 'at most 120 months');
select public.t_ok(public.t_refused($q$update public.integration_expiry set duration_count = 0$q$) = '23514', 'at least 1');
select public.t_ok(public.t_refused($q$insert into public.integration_expiry (service, starts_on, duration_count, duration_unit, ends_on) values ('psn', '2026-01-01', 1, 'days', '2026-01-02')$q$) = '23514',
  'only the services the app can''t read');
reset role;
select public.t_ok((select count(*) from public.audit_logs where table_name = 'integration_expiry') = 3, 'the key''s dates are audited');

-- ── The nightly warnings ─────────────────────────────────────────────────────
update public.integration_expiry set starts_on = '2026-11-01', duration_count = 40, duration_unit = 'days';  -- ends 11.12.2026
insert into public.psn_tokens (user_id, npsso, npsso_expires_at) values ('00000000-0000-0000-0000-000000000001', 'x', '2026-12-06 10:00+00');
select public.t_ok(public.notifications_daily('2026-11-20 05:40+00') = 0, '16 and 21 days ahead: nothing yet');
select public.t_ok(public.notifications_daily('2026-11-26 05:40+00') = 1, 'PlayStation 10 days ahead: its 14-day warning; the key (15 days) nothing yet');
select public.t_ok(public.notifications_daily('2026-11-26 05:40+00') = 0, 'a second run the same night adds nothing');
select public.t_ok(public.notifications_daily('2026-11-27 05:40+00') = 1, 'next night: the key''s 14-day warning, PlayStation''s 14 not again');
select public.t_ok((select dedupe_key from public.notifications where kind = 'sign_in_expiring') = 'sign_in_expiring:psn:2026-12-06:14'
  and (select due_on from public.notifications where kind = 'sign_in_expiring') = '2026-12-06',
  'the dedupe key holds the end day and the mark');
select public.t_ok(public.notifications_daily('2026-12-03 05:40+00') = 1, '3 days ahead (a missed week): only the current mark (7), never a burst');
select public.t_ok(public.notifications_daily('2026-12-05 05:40+00') = 2, 'PlayStation 1 day ahead: its last warning; the key 6 days ahead: its 7-day one');
select public.t_ok(public.notifications_daily('2026-12-07 05:40+00') = 0, 'the day has passed: no more warnings for PlayStation');
select public.t_ok((select count(*) from public.notifications where kind = 'sign_in_expiring') = 3, 'PlayStation warned 14, 7 and 1 days ahead');
select public.t_ok((select count(*) from public.notifications where kind = 'sign_in_expiring' and read_at is null) = 3, 'all unread so far');
update public.psn_tokens set npsso_expires_at = '2027-02-01 10:00+00';
select public.t_ok((select count(*) from public.notifications where kind = 'sign_in_expiring' and read_at is null) = 0,
  'a renewed sign-in puts the old warnings away');
set role authenticated;
update public.integration_expiry set starts_on = '2026-12-01', duration_count = 3, duration_unit = 'months';
reset role;
select public.t_ok((select count(*) from public.notifications where kind = 'claude_key_expiring' and read_at is null) = 0,
  'new key dates put the old key warnings away (the browser''s own write, through its read_at)');

-- ── A service rejected the sign-in or key ────────────────────────────────────
select public.t_ok(public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'trakt') is not null, 'Trakt rejected the sign-in: a notice');
select public.t_ok(public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'trakt') is null, 'the next sync run the same day: none');
update public.notifications set created_at = created_at - interval '3 days', dedupe_key = 'sign_in_failed:trakt:2026-01-01' where kind = 'sign_in_failed';
select public.t_ok(public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'trakt') is null, 'days later, while the first is unread: none');
update public.notifications set read_at = now() where kind = 'sign_in_failed';
select public.t_ok(public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'trakt') is not null, 'read, and it fails again: a new one');
insert into public.t_keep values ('anthropic', public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'anthropic')::text);
select public.t_ok((select kind from public.notifications where id = (select v::uuid from public.t_keep where k = 'anthropic')) = 'claude_key_rejected',
  'Anthropic rejecting the key is the Claude key''s own kind');
select public.t_ok(public.t_refused($q$select public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'psn'' or 1=1')$q$) = '22023', 'a service outside the list is refused');

-- ── Delivery: the claim ──────────────────────────────────────────────────────
update public.notifications set pushed_at = null;
-- Waiting push_now: Trakt's new failure, Anthropic's rejection (both created just now). An old one (3 days) never.
select public.t_ok(public.notifications_push_due('push_now', now()), 'a push_now notice waits');
select public.t_ok((select count(*) from public.notifications_claim('00000000-0000-0000-0000-000000000001', 'push_now', now())) = 2,
  'the claim takes the unread push_now notices of the last 2 days');
select public.t_ok(not public.notifications_push_due('push_now', now()), 'claimed: none waits');
select public.t_ok((select count(*) from public.notifications_claim('00000000-0000-0000-0000-000000000001', 'push_now', now())) = 0, 'a second claim takes none');
select public.t_ok(public.notifications_unclaim('00000000-0000-0000-0000-000000000001',
  array(select id from public.notifications where pushed_at is not null), (select max(pushed_at) from public.notifications)) = 2,
  'no device took it: the stamps go back');
select public.t_ok(public.notifications_unclaim('00000000-0000-0000-0000-000000000001',
  array(select id from public.notifications), '2000-01-01') = 0, 'an unclaim puts back only its own stamps');
select public.t_ok((select count(*) from public.notifications_claim('00000000-0000-0000-0000-000000000002', 'push_now', now())) = 0, 'a claim is one account''s');
select public.t_ok(public.t_refused($q$select * from public.notifications_claim('00000000-0000-0000-0000-000000000001', 'in_app', now())$q$) = '22023', 'in_app is never pushed');
-- The owner reads one in the app before the timer: it is never pushed.
update public.notifications set read_at = now() where kind = 'claude_key_rejected';
select public.t_ok((select count(*) from public.notifications_claim('00000000-0000-0000-0000-000000000001', 'push_now', now())) = 1, 'a notice read in the app is never pushed');
-- Morning and weekly windows; a notice whose kind the owner moved to the morning.
insert into public.notification_prefs (user_id, kind, channel) values ('00000000-0000-0000-0000-000000000001', 'follow_new_title', 'push_morning');
insert into public.media_follows (id, user_id, kind, tmdb_id, name) values
  ('11900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'actor', 2, 'An actor');
insert into public.media_follow_events (id, user_id, follow_id, kind, tmdb_id, title, created_at) values
  ('11900000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000001', '11900000-0000-0000-0000-000000000002', 'new_title', 7, 'Morning Film', now());
select public.t_ok((select string_agg(subject, ',') from public.notifications_claim('00000000-0000-0000-0000-000000000001', 'push_morning', now())) = 'Morning Film',
  'the morning claim takes the kinds the owner sends to the morning, with the thing''s name');
update public.notification_prefs set channel = 'push_weekly' where kind = 'follow_new_title';
update public.notifications set pushed_at = null, created_at = now() - interval '6 days' where kind = 'follow_new_title';
select public.t_ok(public.notifications_push_due('push_weekly', now()) and not public.notifications_push_due('push_morning', now()),
  'a 6-day-old weekly notice waits for Monday; the morning window (2 days) is past');
select public.t_ok((select count(*) from public.notifications_claim('00000000-0000-0000-0000-000000000001', 'push_weekly', now())) = 1, 'the weekly digest takes it');

-- ── The push timer calls push-send only when something waits ────────────────
do $$ begin execute (select command from cron.job where jobname = 'lascis-notifications-push'); end $$;
select public.t_ok((select count(*) from net.sent) = 0, 'nothing waits: the timer sends no request');
select public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'strava');
do $$ begin execute (select command from cron.job where jobname = 'lascis-notifications-push'); end $$;
select public.t_ok((select count(*) from net.sent where body ->> 'trigger' = 'notifications' and url like '%/push-send'
  and headers ->> 'x-cron-secret' = 'test-cron-secret') = 1, 'a push_now notice waits: one request to push-send with the Vault secret');
do $$ begin execute (select command from cron.job where jobname = 'lascis-notifications-daily'); end $$;
select public.t_ok(true, 'the nightly timer''s command runs');

-- ── Film news has one "read" (seen_at ⇄ read_at) ─────────────────────────────
insert into public.media_follows (id, user_id, kind, tmdb_id, name) values
  ('11900000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'company', 3, 'A studio');
insert into public.media_follow_events (id, user_id, follow_id, kind, tmdb_id, title) values
  ('11900000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000001', '11900000-0000-0000-0000-000000000003', 'new_title', 55, 'Seen in Media'),
  ('11900000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-000000000001', '11900000-0000-0000-0000-000000000003', 'trailer', 56, 'Read in the bell');
set role authenticated;
update public.media_follow_events set seen_at = now() where id = '11900000-0000-0000-0000-0000000000e5';
select public.t_ok((select read_at is not null from public.notifications where link_id = '11900000-0000-0000-0000-0000000000e5'),
  'a film marked seen in What''s new puts its notice away');
update public.notifications set read_at = now(), acted_at = now() where link_id = '11900000-0000-0000-0000-0000000000e6';
select public.t_ok((select seen_at is not null from public.media_follow_events where id = '11900000-0000-0000-0000-0000000000e6'),
  'a film notice read (or opened) in the bell marks its event seen');
update public.notifications set read_at = null where link_id = '11900000-0000-0000-0000-0000000000e6';
select public.t_ok((select seen_at is null from public.media_follow_events where id = '11900000-0000-0000-0000-0000000000e6'),
  'its Undo (unread again) makes the event new again');
select public.t_ok(public.t_refused($q$select public.notifications_follow_seen()$q$) <> 'written', 'the sync is a trigger only, never callable');
reset role;
-- Another account's notice that names the owner's event (a forged link) never touches it.
insert into public.notifications (user_id, kind, link_kind, link_id, dedupe_key)
values ('00000000-0000-0000-0000-000000000002', 'follow_trailer', 'media_follow_event', '11900000-0000-0000-0000-0000000000e6', 'follow:forged');
update public.notifications set read_at = now() where dedupe_key = 'follow:forged';
select public.t_ok((select seen_at is null from public.media_follow_events where id = '11900000-0000-0000-0000-0000000000e6'),
  'a notice of another account never marks the owner''s event seen');
set role service_role;
insert into public.media_follow_events (id, user_id, follow_id, kind, tmdb_id, title) values
  ('11900000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-000000000001', '11900000-0000-0000-0000-000000000003', 'new_title', 57, 'From the service role');
reset role;
select public.t_ok((select count(*) from public.notifications where link_id = '11900000-0000-0000-0000-0000000000e7') = 1, 'the service role is on the allow-list');

-- ── Reconnecting settles the failure ─────────────────────────────────────────
select public.notify_service_problem('00000000-0000-0000-0000-000000000002', s) from unnest(array['trakt', 'strava', 'google', 'icloud', 'anthropic']) s;
insert into public.trakt_tokens values ('00000000-0000-0000-0000-000000000002', 'new');
select public.t_ok((select read_at is not null from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and service = 'trakt'),
  'connecting Trakt again puts its "sign in again" notice away');
select public.t_ok((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and read_at is null) = 4,
  'only that service''s');
insert into public.strava_tokens values ('00000000-0000-0000-0000-000000000002', 'old');
update public.strava_tokens set refresh_token = 'refreshed' where user_id = '00000000-0000-0000-0000-000000000002';
insert into public.user_calendar_tokens values ('00000000-0000-0000-0000-000000000002', 'g');
insert into public.icloud_credentials values ('00000000-0000-0000-0000-000000000002', 'sealed');
select public.t_ok((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and read_at is null and kind = 'sign_in_failed') = 0,
  'Strava, Google and Apple Calendar too (a connect or a refresh that worked)');
select public.t_ok((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-000000000001' and kind = 'sign_in_failed' and service in ('google', 'icloud') and read_at is null) = 0
  and (select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-000000000001' and kind = 'sign_in_failed' and service = 'strava' and read_at is null) = 1,
  'another account''s sign-in settles nothing of the owner''s');
select public.t_ok(public.notify_service_settle('00000000-0000-0000-0000-000000000002', 'anthropic') = 1, 'Anthropic answering again settles one notice');
select public.t_ok((select read_at is not null from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and kind = 'claude_key_rejected'),
  'and it is "key rejected", now read');
select public.t_ok(public.notify_service_settle('00000000-0000-0000-0000-000000000002', 'evil') = 0, 'a service outside the list settles nothing');
set role authenticated;
select public.t_ok(public.t_refused($q$select public.notify_service_settle(auth.uid(), 'anthropic')$q$) = '42501', 'the browser cannot call the settle');
reset role;

-- ── 213: PlayStation's refused sign-in ───────────────────────────────────────
select public.t_ok(public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'psn') is not null, 'PlayStation refused the sign-in: a notice');
select public.t_ok((select kind || ':' || service || ':' || coalesce(due_on::text, '-') || ':' || coalesce(link_kind, '-')
                      from public.notifications where kind = 'sign_in_failed' and service = 'psn') = 'sign_in_failed:psn:-:-',
  'it is a "sign in again" notice about PlayStation, with no link and no end day');
select public.t_ok(public.notify_service_problem('00000000-0000-0000-0000-000000000001', 'psn') is null, 'the next refused refresh the same day: none');
select public.notify_service_problem('00000000-0000-0000-0000-000000000002', 'psn');
update public.psn_tokens set npsso_expires_at = '2027-03-01 10:00+00' where user_id = '00000000-0000-0000-0000-000000000001';
update public.psn_tokens set access_token = 'a' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select read_at is null from public.notifications where user_id = '00000000-0000-0000-0000-000000000001' and kind = 'sign_in_failed' and service = 'psn'),
  'a write that is no fresh sign-in (an end day, an access token alone) settles nothing');
update public.psn_tokens set access_token = 'b', refresh_token = 'refreshed' where user_id = '00000000-0000-0000-0000-000000000001';
select public.t_ok((select read_at is not null from public.notifications where user_id = '00000000-0000-0000-0000-000000000001' and kind = 'sign_in_failed' and service = 'psn'),
  'a refresh that worked (a new refresh token) puts the PlayStation notice away');
select public.t_ok((select read_at is null from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and kind = 'sign_in_failed' and service = 'psn'),
  'another account''s PlayStation notice stays');
select public.t_ok((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-000000000001' and kind = 'sign_in_failed' and service = 'strava' and read_at is null) = 1,
  'and the owner''s other services'' notices stay');
insert into public.psn_tokens (user_id, npsso, refresh_token) values ('00000000-0000-0000-0000-000000000002', 'pasted', 'fresh');
select public.t_ok((select read_at is not null from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and kind = 'sign_in_failed' and service = 'psn'),
  'a connect (a fresh npsso pasted) puts it away too');
select public.t_ok(public.notify_service_settle('00000000-0000-0000-0000-000000000002', 'psn') = 0, 'notify_service_settle knows PlayStation (nothing left to settle)');
revoke all on public.psn_tokens from anon, authenticated;  -- as 140 left it live
set role authenticated;
select public.t_ok(public.t_refused($q$update public.psn_tokens set refresh_token = 'forged'$q$) = '42501',
  'the browser cannot write psn_tokens, so it cannot fire the settle (140''s revoke)');
select public.t_ok(public.t_refused($q$select public.notify_service_problem(auth.uid(), 'psn')$q$) = '42501', 'the browser cannot make a PlayStation notice');
reset role;

-- ── 213: the feed reads chosen kinds ─────────────────────────────────────────
set role authenticated;
select public.t_ok((select count(*) from public.notification_feed(200, null, false, array['shop_bought_draft'])) > 0
  and (select bool_and(kind = 'shop_bought_draft') from public.notification_feed(200, null, false, array['shop_bought_draft'])),
  'the Shop''s read: only the Shop''s kinds');
select public.t_ok((select count(*) from public.notification_feed(200, null, false, null)) = (select count(*) from public.notification_feed(200, null, false)),
  'no kinds: every kind (the website before 213 sends none)');
select public.t_ok((select count(*) from public.notification_feed(200, null, false, array['phishing'])) = 0, 'an unknown kind matches nothing');
select public.t_ok((select count(*) from public.notification_feed(p_limit => 30, p_before => null, p_unread_only => true)) >= 0,
  'the old named call (three arguments) still reaches the feed');
reset role;
select public.t_ok((select count(*) from pg_proc where proname = 'notification_feed' and pronamespace = 'public'::regnamespace) = 1,
  'one feed function (two would make PostgREST''s call ambiguous)');
select public.t_ok(not has_function_privilege('anon', 'public.notification_feed(integer, timestamptz, boolean, text[])', 'execute'),
  'the feed is not anon''s');

-- ── The owner lock ───────────────────────────────────────────────────────────
select public.notify_service_problem('00000000-0000-0000-0000-000000000003', 'google');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000003';
select public.t_ok((select count(*) from public.notifications) = 0, 'an account outside the owner lock reads none of its notices');
select public.t_ok((select count(*) from public.notification_feed(30, null, false)) = 0, 'nor through the feed');
reset test.uid;
select public.t_ok((select count(*) from public.notification_feed(500, null, false)) <= 200, 'the feed reads at most 200');
select public.t_ok((select bool_and(read_at is null) from public.notification_feed(30, null, true)), 'unread only');
reset role;
