# Notifications (Phase 3 B1–B3, 26.11.2026)

The owner asked for one place where the app tells him what needs a look, and for the choice of how each kind reaches
him ("Notifications B1–B3", one PR, 26.11.2026; the plan's owner decisions of 25.11.2026). Migration `212`; the
table itself is `211`'s.

## What the owner sees

- **The bell** sits next to the avatar in the top bar and in the phone header (`NotificationBell`). A red count shows
  the unread notifications (99+ above 99); it is read again every 5 minutes and when the app comes back to the front.
  Tapping it opens a drop-down (Headless UI Popover) with the newest 8; its header holds **Read all** (with Undo),
  **See all** and a ⚙ link to Settings → Notifications, so they show however short the screen is. Each row is two lines:
  the title, then the detail and when ("Laptop · 23.11.2026 19:20"); an unread one has a dot. The drop-down is at most the screen's height less the phone's bars and
  scrolls inside (the phone held sideways). In the top bar the bell is bordered like Ask AI and Requests; in the phone
  header it is a plain icon button like its neighbours.
- **/notifications** (`NotificationsPage`, in `navigation.ts` and `pages.ts`; no nav row of its own) is the full list:
  **All | Unread**, each row's **Read / Unread** button (with Undo; a filled dot while unread, an empty circle once read —
  the page has no separate dot), **More** for older ones (30 at a time), in a card.
  Both modes have **Read all** and a ⚙ link to Settings → Notifications.
- The drop-down and the page are **one component**, `NotificationList`, with the modes `dropdown` and `page` (owner,
  12.11.2026: "same job, one component"). A mode hides a part (the filter, the per-row button, More), never copies it.
- **Opening a notice** marks it read and acted on, then opens the thing by the kind's fixed way: a Shop thing opens its
  popup by id, a followed film its film popup by its TMDB id, everything else its page (`noticeRoute`). Nothing is
  ever opened from an address stored in a row — there is none.
- **Settings → Notifications** (`?tab=notifications`, `NotificationSettingsTab`): this device's push switch (moved
  here from Appearance; first on the phone) and **What the app tells you** — every kind with a picker: **In app** (only the bell),
  **Now** (a push within 15 minutes), **Morning** (one line in the morning push), **Weekly** (Monday's 08:00 digest).
  The list is the code registry, so it is also how the owner sees what the app watches. A kind with no choice saved
  goes where its default says.
- **The Claude API key's dates** are on the Anthropic card in Settings → Subscriptions (connections live in one place;
  `ClaudeKeyDates`): **Made on** (default today), **Lasts** (a number of days or months) and, optionally, the key's
  **Last 4** characters (to tell keys apart). The card shows the end day before the save ("Ends 26.11.2027 (in 365
  days)"); **Save** keeps the dates, **Clear** asks and then says "Key dates cleared · Undo". The app never reads the
  key (owner decision 25.11.2026: an Admin API key that could read it can also create and delete keys — too much
  power for one date).
- Shop's **Needs a look** keeps showing "Bought through a plan" as before (its own read, `qk.notifications.shop()`);
  the same notice is in the bell, and reading it in one place reads it in the other.

## The kinds

| Kind | Made by | Default | Opens |
|---|---|---|---|
| `sign_in_failed` | Trakt (401 / `invalid_grant`), Strava (a 401 to the refresh — a 400's body is undocumented, `docs/integrations/strava.md`), Google (`google-tasks-sync`, `calendar-token`: `invalid_grant`), Apple Calendar (the iCloud timer: Apple refused the password) — through `notify_service_problem` | Now | Settings → Subscriptions |
| `sign_in_expiring` | The nightly job: PlayStation's `psn_tokens.npsso_expires_at`, 14, 7 and 1 days before | Morning | Settings → Subscriptions |
| `claude_key_rejected` | `claude` when Anthropic rejects the key | Now | Settings → Subscriptions |
| `claude_key_expiring` | The nightly job: the key's end day as typed, 14, 7 and 1 days before | Morning | Settings → Subscriptions |
| `shop_bought_draft` | 211's plan-effect trigger (a ticked Shop plan bought the thing) | In app | the Shop thing's popup |
| `follow_new_title` | A follow's new film (`media_follow_events`, 119), written by the server | Weekly | the film's popup |
| `follow_trailer` | A follow's new trailer, written by the server | In app | the film's popup |

The registry is `src/features/notifications/notificationKinds.ts` (`NOTICE_KINDS`: label, hint, default). Its text
block (`<notification-text>`: titles, second lines, routes, the push and the morning line) is copied verbatim into
`push-send`; `verify-notifications` compares them. The defaults are also SQL's `notification_default_channel`;
`verify-db-notifications` compares them and the kind lists.

## How it is stored (212)

- `notifications` (211) gets `service` (an allow-list code), `due_on` (the end day of a sign-in or key), `acted_at`
  (the owner opened the thing from it) and `pushed_at` (push-send's). Each kind has **one shape** (a check: what it
  links to, which service, whether it has an end day); an unknown kind is refused. There is still **no text and no URL
  column**: titles and routes come from the registry, the thing's name from its own table at read time. The dedupe key
  is built only in SQL (`kind:part[:part[:part]]`, lower-case letters, digits, `_` and `-`).
- Rows are written only by `notify_row()` (SECURITY DEFINER, service role only). 211's `notify()` keeps its arguments
  and goes through it. The browser reads its own rows and may set `read_at` and `acted_at` (a column grant), nothing
  else; it can't insert or delete.
- `notification_feed(limit, before, unread_only)` (SECURITY INVOKER) is the screen's read: the caller's own rows, newest
  first, at most 200, with the thing's name (`notification_subject`) and a film's TMDB id. Before 212 the app reads
  211's columns without names; before 211 it shows none.
- `notification_prefs` (account, kind → channel; audited, owner lock). `notification_channel(user, kind)` = the
  owner's choice, else the default.
- `integration_expiry` (account, service `anthropic` → start day, duration, `ends_on`, optional `key_hint`; audited,
  owner lock). `ends_on` is the database's: a trigger works it out from the start and the duration (months as Postgres
  adds them: 31.01 + 1 month = 28.02); `keyExpiry.ts` shows the same day in the form. `key_hint` takes exactly 4 key
  characters.
- A new end day (a renewed PlayStation sign-in, new key dates) puts the old warnings away (read), so the bell never
  shows an old date.

## What makes a notice

- **Followed films:** a trigger on `media_follow_events` makes one notice per event — only when the server wrote the
  event (an allow-list: `current_user` is `service_role`, `postgres` or `supabase_admin`): the browser can write that
  table (119's policy), and a row it writes must not become a notice. A removed event (the follow check's clean-up, an
  unfollow) takes its notice along.
- **Film news has one "read"** (owner-critic, 26.11.2026): marking an event seen in Media → What's new reads its
  notice, and reading or opening the notice marks the event seen; making the notice unread again (its Undo) makes the
  event new again. The notice → event direction is a SECURITY DEFINER trigger that touches only the one event the notice
  links to, of the notice's own user.
- **The nightly job** `notifications_daily` (pg_cron `lascis-notifications-daily`, 05:40 UTC — before the morning
  push): for every PlayStation sign-in and Claude key that ends within 14 days, one notice per end day and mark
  (14, 7 or 1; days are Oslo's). A missed night gives only the current mark, never a burst; a passed day gives none.
- **A refused sign-in or key:** `notify_service_problem(user, service)` (service role only; the service is an
  allow-list) writes at most one per service and Oslo day, and none while an unread one about that service is there.
  The functions call it best effort: a failure there never changes their answer.
- **Reconnecting settles it:** a fresh sign-in written to `trakt_tokens`, `strava_tokens`, `user_calendar_tokens` or
  `icloud_credentials` (a connect, or a refresh that worked) reads that service's unread failure notice; `claude` calls
  `notify_service_settle(user, 'anthropic')` after a call Anthropic answered, which reads "key rejected" (never a
  trigger on the ledger, 194's rule).

## Delivery (B3)

- `lascis-notifications-push` (every 15 minutes) calls `push-send` `{trigger: 'notifications'}` only when a `push_now`
  notice waits (`notifications_push_due`). `push-send` claims them (`notifications_claim`: unread, not pushed, made in
  the last 2 days, `FOR UPDATE SKIP LOCKED`, stamped `pushed_at`) and sends **one** push: one notice → its own title,
  second line and page; several → "🔔 3 notifications" with the first four, to `/notifications`.
- `lascis-notifications-weekly` wakes at 06:00 and 07:00 UTC on Monday and goes on only in the hour that is 08 in Oslo
  (winter or summer time): `{trigger: 'notifications', digest: 'weekly'}` sends the `push_weekly` notices of the last
  8 days as one digest.
- The morning push (068's `lascis-morning-push`, unchanged) carries the `push_morning` notices of the last 2 days as
  **one line** ("🔔 PlayStation sign-in ends in 7 days, … +1") — no second push.
- When the push services took no push, the stamps go back (`notifications_unclaim`) and the next run tries again; with
  no device at all the stamps stay (the bell has the notice). A notice read in the app before its push is never
  pushed. The notifications path is the cron's only (`x-cron-secret`, `PUSH_CRON_SECRET` from Vault inside the job).
- iOS: a push reaches only the app installed on the home screen with notifications on; every push shows a visible
  notification; it can arrive minutes late; nothing runs while the app is closed, so the server does all the work
  (`docs/iphone-web-integration.md`). No app-icon badge yet (the Badging API is a possible later step).

## Security (what an attacker controlling each input could do)

- **A stolen browser session** can mark notices read or acted (its own rows only), choose channels (bounded to four
  values), and type key dates (bounded dates, a 4-character hint). It cannot write, re-point or delete a notice, call
  `notify_row`, `notify_service_problem`, the claim or the nightly job, or make a follow-event notice (the trigger
  ignores browser writes). The worst is noise in the owner's own bell; there is no link to plant.
- **A forged `media_follow_events` row** (the table the browser can write) makes no notice; a server-made notice shows
  the event's title only as text.
- **A sync function** passes only a service code; the database refuses any other value and builds the dedupe key
  itself.
- **The push** text and address come from the registry; the thing's name is cut to printable characters (no control,
  bidi or line-break characters) and 60 characters (`noticePushSubject`; the bell shows up to 300), and the address is
  a fixed hash route per kind, never data from a row.
- **The Claude key** is never read or stored; only the owner's dates and an optional 4-character hint.
- Ask AI has no tool that reaches these tables.

## Checks

`verify-notifications` (the registry's words and routes, the row check, the key's end day, the producers, push-send's
path and the verbatim block, one list for both modes) and `verify-db-notifications` (212 twice, the shapes, the
browser's rights, the follow trigger, the prefs, the key dates, the 14/7/1 warnings, the service problems, the claim and
the timers; PR check with `DEPLOY_TEST_DB_URL`).
