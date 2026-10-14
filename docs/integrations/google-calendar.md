# Google Calendar

Checked: 13.10.2026 against Google's own docs — the Events reference (developers.google.com/workspace/calendar/api/v3/reference/events and its `insert` / `patch` / `instances` pages), the guides "Recurring events" (…/guides/recurringevents) and "Calendars & events" (…/concepts/events-calendars), and RFC 5545 §3.3.10 / §3.8.5 (which the reference names for the `recurrence` lines). No live sample: there are no credentials in a development session — the repeating-event calls were run against a fake Calendar API in the mock harness only.

Written when repeating plans started going to Google Calendar (migration 147); the one-off slot link (038, 135) is older and is described here too. 14.10.2026 (migration 148): a series starts on the day the plan was added, and Settings → Subscriptions → Google adds every plan at once — no new endpoint or field, the same calls below. How it works in the app: `docs/features/planning-calendar.md` → Repeating plans on Google Calendar, Two-way block ↔ event link, the calendar outbox.

## How we authenticate

- The one Google sign-in (`GOOGLE_SCOPES` in `src/features/calendar/googleScopes.ts`): `calendar.events` (read and write events — creating a repeating event needs nothing more), `calendar.calendarlist.readonly` (the calendar picker) and `tasks`.
- `calendar-oauth` keeps the refresh token in `user_calendar_tokens` (service role only). The browser asks `calendar-token` for an hour-long access token; every write goes through `ensureValidCalendarToken()`, which refreshes one that is past its hour. `google-tasks-sync` refreshes its own for the calendar outbox (cron with `x-sync-secret` = `GOOGLE_TASKS_SYNC_SECRET`, or the user's JWT).
- The token goes in the `Authorization: Bearer` header, never the URL.

## Endpoints we call

Base `https://www.googleapis.com/calendar/v3`. Every event the app links lives in the user's `primary` calendar.

| Endpoint | Called by | When | Limits |
|---|---|---|---|
| `GET /users/me/calendarList` | browser (`useCalendarList`) | the agenda, the calendar picker | |
| `GET /calendars/{cal}/events` (`timeMin`, `timeMax`, `singleEvents=true`, `orderBy=startTime`, `maxResults=250`, `pageToken`) | browser (`calendarApi.listAllEvents`), `ai-proxy` (`get_calendar_events`, primary only) | the day agenda, Home, the week/month dots; the assistant's next days | `timeMax` is exclusive; "The number of events in the resulting page may be less than this value, or none at all, even if there are more events matching the query. Incomplete pages can be detected by a non-empty `nextPageToken`" — every page is read (max 2500 per page) |
| `POST /calendars/primary/events` (with our own `id`) | browser (`linkBlockCalendarEvent`, `scheduleSeriesCalendar`) | a slot or a repeating plan added to Google Calendar (one plan from the planner, or every plan not on it yet from Settings → Subscriptions → Google — one after another); Undo after a delete | id: base32hex (`a-v`, `0-9`), 5–1024 chars, unique per calendar |
| `GET /calendars/primary/events/{id}` | browser | after a 409 on our own id: adopt it, unless it is `cancelled` | |
| `PATCH /calendars/primary/events/{id}` | browser (`updateTimeBlock`, `scheduleSeriesCalendar`) | a slot moved / renamed; a repeating plan saved; a monthly plan's RDATE list extended; once for a series linked before 148 (its start moves to that day) | 3 quota units each |
| `DELETE /calendars/primary/events/{id}` | browser, `google-tasks-sync` (calendar outbox) | a slot or plan deleted or unticked | 404 / 410 = already gone |

## Fields we read and write

| Field | Shape (Google's reference) | Where it goes |
|---|---|---|
| `id` | string; may be set at creation | `time_blocks.google_calendar_event_id`, `schedule_blocks.google_calendar_event_id` (147). We send `blockEventId(rowId, n)`: the row's uuid without dashes, then `<hex>v1`, `<hex>v2`… |
| `summary` | string | the slot's or plan's title |
| `start` / `end` | `{ dateTime, timeZone }`; "A time zone offset is required unless a time zone is explicitly specified in timeZone"; `timeZone` "For recurring events … is required and specifies the time zone in which the recurrence is expanded" | a slot: UTC instant + the device's zone. A repeating plan: its first day on Google — the rule's first day on or after the later of `effective_from` and the day it was added (`schedule_blocks.google_calendar_from`, 148) — at its wall-clock time with no offset (`2026-10-14T16:30:00`) + the series' zone, stored in `schedule_blocks.google_calendar_time_zone`: the device's when created or saved in the planner (Europe/Oslo when it names none), reused by every background push. End = start's day, or the next day when the plan crosses midnight (end ≤ start) |
| `recurrence` | string[]: "List of RRULE, EXRULE, RDATE and EXDATE lines for a recurring event, as specified in RFC5545. Note that DTSTART and DTEND lines are not allowed in this field" | a repeating plan's rule (`calendar/calendarSeries.ts`, below) |
| `status` | `confirmed` \| `tentative` \| `cancelled` | read: a `cancelled` event under our id is one we deleted (Google keeps it) — never adopted |
| `recurringEventId` | on an instance: "the id of the recurring event to which this instance belongs" | read: the agenda hides instances of a linked plan's series (`daySchedule.isLinkedCalendarEvent`) |
| `start.date` / `end.date` | all-day events | read only (agenda rows) |
| `htmlLink`, `colorId`, `description`, `location` | | read only (the event popup) |

### A repeating plan's `recurrence` (147)

"The recurrence is defined as the union of all RRULE and RDATE rules, minus the ones excluded by all EXDATE rules"; `start`/`end` "define the first occurrence"; RFC 5545: DTSTART "always counts as the first occurrence" and a DTSTART "not synchronized with the recurrence rule is undefined". So `start` is the plan's first real day on or after the later of `effective_from` and the day it was added to Google (148: an old plan added today must not bring its past weeks; the day is stored with the link, so the start never moves on a later push). Google shows nothing before `start`; the app's own agenda still shows the plan from `effective_from`.

| Plan | Lines we send |
|---|---|
| Weekly / Weekdays | `RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,TU,WE,TH,FR` |
| Every day | `RRULE:FREQ=DAILY` |
| Every N days | `RRULE:FREQ=DAILY;INTERVAL=N` |
| Every N weeks | `RRULE:FREQ=WEEKLY;INTERVAL=N;WKST=MO;BYDAY=TU,TH` (WKST=MO: the app counts Monday-first weeks) |
| Monthly, every N months | `RDATE;TZID=Europe/Oslo:20261212T163000,20270116T163000,…` — a year past the later of today and the first day; `schedule_blocks.google_calendar_horizon` keeps how far, and the app pushes the list again when it opens with fewer than 90 days left |
| Picked dates | `RDATE;TZID=…:…` — every pick after the first (they are all known) |
| A day taken out (`except_dates`) | `EXDATE;TZID=Europe/Oslo:20261020T163000` — only days the rule really has ("This must point to a valid instance generated by the recurrence rule"); for the RDATE kinds a later day is simply left out of the list |

Date-times in RDATE/EXDATE are local times with `TZID` (RFC 5545: `RDATE;TZID=America/New_York:19970714T083000`, `EXDATE;TZID=America/New_York:19970902T090000`; Google: "EXDATE and RDATE can have a time zone"), so a 16:30 plan stays 16:30 across a daylight-saving change. No `UNTIL` or `COUNT`: a plan has no end.

## Fields we deliberately don't use

- `iCalUID`: "only one of them should be supplied at event creation time" — we supply `id`, which also gives the retry safety.
- Instance exceptions (editing one instance through `events.instances` + PUT): a day changed in the app becomes its own one-off slot with its own event (142's `schedule_block_id` + `occurrence_date`) and an EXDATE on the series, so the series never carries per-day edits we would have to track.
- `EXRULE`: no repeat kind needs it.
- `attendees`, `reminders`, `sendUpdates`, `colorId` on write: the events are the owner's own; Google's defaults apply.
- `syncToken` / incremental sync: the app reads one day (or one range) at a time.

## Traps

- **409 on our own id.** A deleted event stays under its id with `status: cancelled`, and a new insert with that id answers 409 — so a re-link after an unlink or an Undo after a delete walks `<hex>`, `<hex>v1`, … past cancelled ones; after five, Google picks the id. A 409 on a live event is our own earlier create whose answer was lost: it is adopted (a series is brought up to date with one PATCH).
- **404 and 410.** A delete of an already-deleted event answers 410 "Gone"; both mean "gone" (`isCalendarNotFound`). A PATCH that answers 404/410 means the owner deleted it in Google Calendar: the app forgets the link ('not_linked') and makes a new one when the box is still ticked.
- **PATCH replaces arrays.** "Array fields, if specified, overwrite the existing arrays" — every save sends the whole `recurrence`.
- **Start must fit the rule.** A Tuesday start for a Mon/Wed rule would add a Tuesday in Google; the start is the rule's first real day — also from the day it was added (an every-2-weeks plan keeps its own weeks: the next day the app has, not a week after the add).
- **Moving the start drops the past.** The occurrences are `start` plus the rule (RFC 5545), so a PATCH with a later `start` leaves out the instances before it (we never edit single instances, so none is left behind) — not yet tried on a real account (`docs/deploy-checklist.md`). That is how a series linked before 148 loses its past weeks (once, when the app opens). A day before the start is never carried to Google (no EXDATE, no event of its own).
- **The list expands instances.** `singleEvents=true` returns each occurrence with its own id (`<seriesId>_<…>`) and `recurringEventId`; matching linked rows by id alone shows a linked plan twice.
- **Cross-midnight.** An event that started yesterday and ends today is in today's list too (`event.end > timeMin`); the agenda clips it (`projectCalendarEventForDay`) and hides it when linked.
- **Background pushes.** A day carried over or an Undo whose push answers 'unknown' is retried on the next app open (a per-device list, cleared on sign-out); the day's own event is made only after the series took its EXDATE, or Google would show the session twice.
- **No token in triggers.** A slot or plan deleted on the server queues its event in `calendar_outbox` (135, 147); `google-tasks-sync` deletes it within ~20 minutes and never deletes an event a live slot or plan still points at.

## Log

- 13.10.2026 — last check against Google's Calendar reference and guides (see Checked above).
