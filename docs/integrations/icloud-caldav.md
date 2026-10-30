# iCloud Calendar (CalDAV)

Checked: 29.10.2026 against the CalDAV standard (RFC 4791 calendar access, RFC 6578 sync-collection, RFC 5545 iCalendar), Apple's support pages on app-specific passwords (support.apple.com/102654, support.apple.com/121539) and published iCloud CalDAV guides (cli.nylas.com/guides/icloud-caldav-settings; tsdav's iCloud notes). **Live sample: the owner's Apple check, 29.10.2026** (Phase 1: test events written to the owner's iCloud, what iCloud kept read back, the owner's report of the iPhone and Mac — results in the field table and the Log). Read my calendars ran live the same day (the owner's own iCloud calendar read; subscriptions, Google and work calendars aren't in iCloud). Lines still marked *(to confirm)* have no live run yet.

The owner's wishes and the phases this serves: `docs/features/calendar-plan.md`.

Why: the owner uses Google Calendar only to reach Apple Calendar ("our main focus should be on how Apple will handle it"). Apple Calendar shows Google events only partly (no event colour, notes as raw HTML on some iPhones, double alerts). iCloud is Apple's own calendar store; CalDAV is the protocol Apple's own Mac Calendar, Outlook, Thunderbird, BusyCal and DAVx5 use for it. Apple offers no other calendar API (no REST, no developer keys); Apple's support page names app-specific passwords as the way "apps made by developers other than Apple" sign in to iCloud Mail, Calendar and Contacts.

## How we authenticate

- **App-specific password.** The owner makes one at account.apple.com (Sign-In and Security → App-Specific Passwords; needs two-factor authentication) and enters it with the Apple ID email in Settings → Subscriptions → Apple Calendar (iCloud). The normal Apple ID password does not work for CalDAV.
- **Stored on the server only**: `icloud_credentials` (migration 171 — service role only, `REVOKE ALL … FROM anon, authenticated`, never in `ai-proxy`'s catalog). The browser never reads it back; it sees only derived status from the `icloud-calendar` function (connected, the email with its middle masked, when, the last problem). Never logged; mutations that carry it set `logPayload: false`. The function reads the password only for the actions that call iCloud (check, changes, read, setup, remove).
- **Sealed since Phase 2a (172):** the function stores the password only as `enc:v1:<iv>:<ciphertext>` — AES-GCM with a 256-bit key from the Edge Function secret `ICLOUD_ENC_KEY`, a new 12-byte IV per seal, the account id as additional data (a sealed value moved to another row doesn't open). `connect` refuses without the key; `icloud_credentials.password_sealed` (generated) tells the card without reading the password. **Honest limits:** the Phase 1 password stays plain text until the function next reads it with the key (then it is sealed), and database backups taken since Phase 1 hold it plain regardless — so after the key is set, the clean way is to revoke the Phase 1 password at account.apple.com and connect with a new one (optional step in `docs/deploy-checklist.md`). From then on, a database dump alone doesn't open the calendar.
- **What it opens**: iCloud Mail, Contacts and Calendars of that Apple ID (not Photos, Drive, payments or account changes). The app only ever calls CalDAV. Revoke: account.apple.com → App-Specific Passwords; changing the Apple ID password revokes every app-specific password. Disconnect in the app deletes the stored copy only — say so.
- **HTTP Basic** over HTTPS (`Authorization: Basic base64(email:password)`) on every request. Apple's newer "authorise with your Apple Account" flow (no password) is offered only to "supported third-party apps" Apple doesn't name — not available to us.
- **Credentials never leave iCloud's CalDAV hosts**: every URL the function calls — including any `href` or `Location` iCloud answers with — must be `https://`, carry no user name of its own, and be `caldav.icloud.com` or a `pNN-caldav.icloud.com` partition (`isICloudUrl`; not any `*.icloud.com`); redirects are followed by hand (`redirect: 'manual'`, at most 4 hops, a 303 continues as a GET without the body), because `fetch` drops `Authorization` on a cross-host redirect and an unchecked one could carry it elsewhere.
- **Apple refusing the password** answers 400 to the browser ("Apple did not accept…"), never 401 — a 401 would read as the app's own sign-in failing.
- **The timer (175, 176)**: pg_cron calls `icloud-calendar` every 5 minutes while an area is on Apple (before 176: every 10 minutes, only when something waited), with `x-sync-secret` = `ICLOUD_SYNC_SECRET` (Vault and Edge Function secrets, compared in constant time) — no user token; it drains every connected account the app serves and answers counts only. Missing secret: refused.
- **Disconnect is refused while an area shows in Apple Calendar** (its new items would reach no calendar): move it back to Google first.
- **A failed read of the stored row** answers 502, never "not connected": the card would offer Connect, and Apple shows a password only once. Every successful action clears `last_error`; a failed one re-reads the status.

## Endpoints we call

Base `https://caldav.icloud.com`. Each account's calendars live on its own partition host (`https://pNN-caldav.icloud.com:443/<id>/calendars/`), learned by discovery.

| Request | When | Notes |
|---|---|---|
| `PROPFIND /` (`Depth: 0`, `current-user-principal`) | Connect | 401 = wrong email / not an app-specific password. Answer: the principal's href |
| `PROPFIND <principal>` (`Depth: 0`, `C:calendar-home-set`) | Connect | the calendar home (often on the `pNN-caldav` host) — stored |
| `MKCALENDAR <home>lasci-test/` (`displayname`, `apple:calendar-color`, `C:supported-calendar-component-set` VEVENT) | the check | iCloud lets the app make a calendar (201, purple — confirmed 29.10.2026). 201 = made. 405 = something is there already: a `PROPFIND` (`Depth: 0`) counts it only when it is a calendar called "Lasci · Test" |
| `PROPFIND <home>` (`Depth: 1`, `displayname`, `resourcetype`) | the check, when MKCALENDAR didn't give the test calendar | finds a calendar the owner made on the iPhone called "Lasci Test" — case and punctuation ignored (`isTestCalendarName`), since the iPhone keyboard has no easy "·" |
| `PUT <calendar>/<uid>.ics` (`Content-Type: text/calendar; charset=utf-8`, no `If-None-Match`) | the check | one VEVENT per object; UID unique in the calendar. A second run writes over the first (201 new, 204 replaced) |
| `REPORT <calendar>` `calendar-multiget` (the hrefs written) | the check | what iCloud kept of each event (`calendar-data`, `getetag`) |
| `PROPFIND <calendar>` (`Depth: 0`, `sync-token`) then `REPORT <calendar>` `sync-collection` (`Depth: 0`, `sync-token`, `sync-level 1`, `getetag`) | the check / Check changes | RFC 6578 on iCloud: changed hrefs (200) and deleted ones (404) since the token, and a new token. Confirmed 29.10.2026 for a change (an event moved on the iPhone came back with its new day and time); a deletion not tried yet |
| `PROPFIND <home>` (`Depth: 1`, `displayname`, `resourcetype`, `apple:calendar-color`, `C:supported-calendar-component-set`) | Read my calendars | the owner's calendars: a `calendar` resourcetype whose component set has VEVENT (or none given) — not the home itself, the inbox/outbox, notifications or a tasks-only list. At most 20 are read |
| `PROPPATCH <area calendar>` (`displayname`, `apple:calendar-color`) | Create / Update in Apple Calendar (2a) | *(to confirm)* an area's calendar gets its name and colour; 207 with the name among the accepted properties = done; 404 = deleted on the iPhone, made again |
| `MKCALENDAR <home>lasci-<area>/` (`displayname`, `apple:calendar-color`, VEVENT) | Create in Apple Calendar (2a) | one calendar per area at a fixed place, so a rename never makes a second one. 201 = made (confirmed for the test calendar). *(to confirm)* any other answer (405 is the standard "already there") → a `PROPFIND` (`Depth: 0`, `resourcetype`) of the place: taken only when it is a calendar (made by the app before, e.g. before a re-connect cleared where they are), then PROPPATCHed. Where each lives: `icloud_credentials.area_calendars` |
| `PUT <area calendar>lasci-slot-<id>.ics` / `lasci-plan-<id>.ics` (`Content-Type: text/calendar`; `If-Match: <etag>` once the app has written it) | `drain` (2b) | *(to confirm)* one event per slot, ONE series per repeating plan, written over in place (the uid names the item); 201 new, 204 replaced; the answer's `ETag` is kept (`icloud_etag`) — *to confirm that iCloud sends one*. 412 = changed on the iPhone since: not written over — the read-back (2c) takes the change first and keeps iCloud's new version, so the next write goes through. An item that moves area: the new copy first, then `DELETE` of the old one |
| (none — the database) | `drain` (2b-2), right after an Apple copy is in | the item's Google Calendar copy is handed to Google's delete queue (`calendar_outbox`, deleted by `google-tasks-sync`) through `icloud_hand_over` (175): only an event id the app made from that item's own id; any other id is never deleted — its link is cleared (so Google's read-back of it can't reach the item) and it is counted (`foreign`) |
| `DELETE <event>` | `drain` (2b) | an item gone, off the calendar, or back on Google: its event goes (404/410 = gone already). The address is always built from the server-only area calendars and the item's id — a row stores only its area key (security review, 30.10.2026); no area calendar → the row waits, the link is never cleared without a real DELETE |
| `REPORT <area calendar>` `sync-collection` (`Depth: 0`, the stored token, `getetag`) | every drain (2c, 176) | changed events (200 + version) and removed ones (404) since the token; a 403/409/410/412 answer means the token is no longer valid → every event is read again. iCloud ignores `DAV:limit` (python-caldav probe, 10.2026) |
| `PROPFIND <area calendar>` (`Depth: 0`, `sync-token`) then (`Depth: 1`, `getetag`) | the first read-back of a calendar (2c) | the token first, then every event's version — a change made before 2c comes back too; a missing event is never read as deleted here |
| `REPORT <area calendar>` `calendar-multiget` (`getetag`, `calendar-data`, 40 per request) | the read-back (2c) | the app's own events whose version isn't the one the app wrote or last read |
| `PROPFIND <area calendar>` (`Depth: 0`, `displayname`, `apple:calendar-color`) | the read-back on the app's opening and the timer (2c) | a rename or recolour made on the iPhone (compared with what the app last wrote) |
| `PROPFIND <event>` (`Depth: 0`, `getetag`) | right after a PUT whose answer had no ETag (2c) | the event's version, so the read-back can tell the app's own write from a change on the iPhone |
| `REPORT <calendar>` `calendar-query` (`Depth: 1`; `calendar-data` with `C:expand` over the window; filter `VEVENT` + `C:time-range`) | Read my calendars | *(to confirm)* the events touching today and the next 6 days (Oslo midnights as UTC stamps), repeating ones split into their days by iCloud (RFC 4791 §9.6.5 expand). If iCloud ignores expand, a series comes as one object with its `RRULE`: the card lists it apart ("as one series") |
| `PROPFIND <calendar>` (`Depth: 1`, `getetag`) then `DELETE <calendar>` | Remove the test calendar | the whole calendar goes only when it is the app's own `lasci-test/` and holds nothing but the check's events (`lasci-check-<key>-lasciviens-github-io.ics`); otherwise only the check's events are deleted, one by one. The answer says which (`removed: 'calendar' \| 'events'`), and so do the question and the toast |

## Fields we write (the check's events)

All in one `VCALENDAR` (`VERSION:2.0`, `PRODID:-//Lasci's Board//Apple check//EN`), lines folded at 75 octets, text escaped (`\\`, `\;`, `\,`, `\n`).

| Property | What Apple did (the owner's Apple check, 29.10.2026: iCloud kept every one; on the iPhone and Mac all as expected except the two marked) |
|---|---|
| `UID` (`lasci-check-<key>@lasciviens.github.io`), `DTSTAMP` (UTC), `DTSTART`/`DTEND` (`TZID=Europe/Oslo` with a `VTIMEZONE` in each object; `VALUE=DATE` all-day) | the event at the right time, also across summer time |
| `SUMMARY` | the title |
| `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT10M`) | an alert 10 minutes before — once, not twice |
| `DESCRIPTION` (plain text, several lines) | Notes, line breaks kept |
| `URL` | Apple's URL field, a tappable link back to the app |
| `LOCATION` + `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=…;X-TITLE="…":geo:lat,lon` (a public place: Oslo S) + `X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC` | a map pin; "Time to Leave" alerts. Apple's own extensions — no public spec; the read-back shows whether iCloud keeps them |
| `STATUS:TENTATIVE` | **No visible effect**: iCloud keeps it, but Apple Calendar shows the event like any other (probably because Apple shows "Maybe" only as an answer to an invitation — not checked). Phase 2 must not rely on it |
| `CLASS:PRIVATE` | **No visible effect** on the owner's own devices: iCloud keeps it (what others see on a shared calendar — not checked). Phase 2 must not rely on it |
| `TRANSP:TRANSPARENT` | Free (doesn't block time) |
| `RRULE:FREQ=DAILY;COUNT=4` + `EXDATE` (one day left out) | a repeating event with a day taken out |
| calendar `apple:calendar-color` (`#RRGGBBAA`) | the calendar's colour on every Apple device |

## Fields we write (the app's events, Phase 2b)

Built in `src/features/calendar/areas/icloudEvents.ts` from Google's own rules — `calendarEventRules.blockEventBody` for a slot, `calendarSeries.seriesEventFor` for a repeating plan (its RRULE / RDATE / EXDATE lines are RFC 5545 already) — and copied into the function by `scripts/sync-icloud-shared.mjs`:

| Property | From |
|---|---|
| `UID` `lasci-slot-<id>@…` / `lasci-plan-<id>@…`, `DTSTAMP` | the item's id (a move or rename replaces the event in place) |
| `DTSTART` / `DTEND` (`TZID=Europe/Oslo` + `VTIMEZONE`, or `VALUE=DATE`) | the slot's day, time and length; a series' first day on or after `icloud_from` (the day it reached Apple Calendar) |
| `RRULE` / `RDATE` / `EXDATE` | the plan's repeat, exactly as Google gets it |
| `SUMMARY` | "✓ " when done (as on Google), then the area's emoji, then the title |
| `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT<n>M`, `PT0S` at the start) | a timed event: the area's default alert. An all-day event: Settings → Calendar → *All-day alert* (2b-3a), counted from the day's midnight — `PT540M` = 09:00 on the day, `-PT900M` = 09:00 the day before |
| `VALARM` (`ACTION:NONE`, `TRIGGER;VALUE=DATE-TIME:19760401T005545Z`) | alert "None" (2b-3a): Apple's own no-alert marker, so the iPhone doesn't add the owner's default alert — *to confirm live* |
| `DESCRIPTION` | Settings → Calendar → *Notes* (2b-3a): the slot's and task's notes and/or "Open in Lasci's Board" with a link to the day; left out when there's nothing to say |
| `URL` | always: the link to the day |
| `TRANSP` | Busy, or Free for no length and all day |

Which items get one (2b-2): an item that wants a calendar (its Google choice is Calendar or Both; an older item: where it is) in an area whose **Shows in** is Apple Calendar. The drain's rule (`drainStep`): put it there, then its Google Calendar copy goes; an Apple copy stays until the copy that replaces it exists — its Google Calendar event (the area went back to Google) or its Google Task (moved to Tasks; a repeat waits for today's day task) — and the copy appearing queues the item again; otherwise it is removed. A stored version goes back in `If-Match` only as one quoted value (`validEtag`).

Deliberately not written: `STATUS:TENTATIVE` and `CLASS:PRIVATE` (no visible effect on Apple, Phase 1), `ATTENDEE` (no invitations), `LOCATION` (the app keeps no place on a slot yet).

## What an event in Apple Calendar can hold (research, 30.10.2026)

From Apple's EventKit and Calendar guides (iOS 26 / macOS 26), the RFCs and others' iCloud CalDAV notes (python-caldav's iCloud probe of 10.2026, DAVx5/SOGo/Evolution reports). *Confirmed live* = the owner's Apple check (29.10.2026).

| Feature | Apple? | Notes |
|---|---|---|
| Alerts | Yes — the iPhone shows and edits **2 per event**; display only (the alert tone is the owner's own); an absolute-time alert exists in the API, not in the iPhone's picker | Write at most 2 `VALARM` (`ACTION:DISPLAY`), relative to the start. **No VALARM ≠ no alert:** the iPhone may add the owner's default alert; Apple's own "none" marker is `ACTION:NONE` with `TRIGGER;VALUE=DATE-TIME:19760401T005545Z` (2b-3) |
| Location, map pin, Time to Leave | Yes (*confirmed live*) | `LOCATION` + `X-APPLE-STRUCTURED-LOCATION`; Time to Leave is worked out **on the device** (traffic, Maps settings; the owner's Settings → Calendar → Default Alert Times); nothing more to write. Location-based (arrive/leave) alerts are for Reminders, not events |
| Travel time | Probably | Apple writes `X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M` and `X-APPLE-TRAVEL-START`; whether the iPhone obeys them when a server wrote them is *to confirm* |
| Event colour | **No** — only the calendar's colour | `COLOR` (RFC 7986) is ignored; one calendar per area is the way (19, 35) |
| Notes, link | Yes (*confirmed live*) | `DESCRIPTION`, `URL`; a Zoom/Teams/FaceTime link in the event gets a **Join** button. `CONFERENCE` is not read |
| Busy/Free, Maybe, private | Stored, not shown | the iPhone no longer offers "Show As" for iCloud calendars; Maybe and Private show nothing (*confirmed live*) |
| Attachments | Unclear for a server | the iPhone adds files to iCloud events; an `ATTACH` URL from a server is *unconfirmed* — and a known attack route (auto-download), so not used |
| Invitations | Yes, but by email in the owner's name | an `ORGANIZER` of the owner's own address plus `ATTENDEE` makes iCloud email invitations; the owner can't invite themselves. Not used without the owner's explicit decision |
| Free/busy query | **No** (iCloud answers 400/403) | "find a free time" (Phase 3) reads the events themselves (`calendar-query`, which iCloud expands) |
| Categories, priority, GEO alone | Not shown | not written |
| Focus | Per calendar | a Focus can show chosen calendars only — another reason for one calendar per area |
| Reminders (VTODO) | **No** | the Reminders app left CalDAV in iOS 13; the old lists are frozen |
| Sync timing | iCloud → iPhone by push (seconds to about a minute, not documented); iPhone → app: **no push for other apps** — the app asks (a sync token), and iCloud may answer 503 (rate limit) | the read-back (2c) |
| Google only | — | per-event colour, Meet links, Drive attachments, working location, out of office, focus time, appointment schedules, 5 reminders per event, a free/busy API, push to the server |

## Fields we read

The read-back looks only for the properties above (present or not, and their values) in what `calendar-multiget` returns; Check changes reads each changed event's `SUMMARY` and `DTSTART` (a UTC time is shown on the Oslo clock). Stored in Phase 1: the test calendar's URL (saved before any event is written, so Remove can always find them), its sync token, and the last check's result (`last_check`: the steps, the calendar's name, the day, and per event what iCloud kept — no password, no URL), so the card still shows what to look for after the owner comes back from the Calendar app.

**Read my calendars** (read-only, owner 29.10.2026) reads each calendar's `displayname`, `resourcetype`, `apple:calendar-color` (a `#RRGGBB` only, else none) and `supported-calendar-component-set`, and per event `SUMMARY`, `DTSTART` (with its `TZID`), `RRULE`, `RECURRENCE-ID`, `STATUS` (a cancelled one is left out) and whether it has an `ORGANIZER`/`ATTENDEE` (an invitation). A start is shown on the Oslo clock: UTC and any zone the runtime knows are converted; a floating time and an unknown zone (a Windows name) are shown as written, with the zone named. Nothing of it is stored or logged — the titles go only to the owner's browser, and the card forgets them on reload.

**The read-back (2c, 176)** reads, for the app's own events only: the object's `getetag`, then per VEVENT `UID`, `RECURRENCE-ID`, `DTSTART` / `DTEND` / `DURATION` (with `TZID`, UTC or floating — an unknown zone is never guessed), `TRANSP`, `SUMMARY` (the done mark and the area's emoji taken off), `STATUS` (a cancelled day), `EXDATE` and `LAST-MODIFIED`; per area calendar `displayname` and `apple:calendar-color`. *To confirm live:* that the iPhone writes a UTC `LAST-MODIFIED` on every edit (RFC 5545 says it should). Without one, an edit still counts when iCloud's version differs from the one the app wrote and knew; with neither, it is never applied (the app's own write read back looks the same). Notes, alerts, place and URL edited on the iPhone are not read back.

## Fields deliberately not used (Phase 1)

- `ATTACH` — the owner dropped attachments (11).
- `ATTENDEE` / `ORGANIZER` — the events are the owner's own; an attendee makes iCloud send invitation mail.
- Reminders (`VTODO`) — Apple's Reminders left CalDAV in iOS 13 ("a private silo that only the Apple Reminders app can access"); reaching them takes a script on the device (Scriptable / Shortcuts).

## Traps

- **No push.** iCloud has no webhook; changes come only by asking (`sync-collection`), so "from the iPhone to the app" is as fast as the polling interval.
- **No developer support or published limits.** Apple doesn't document rate limits for CalDAV; keep requests few and back off on 429/503.
- **The partition host.** The calendar home is on `pNN-caldav.icloud.com`, not `caldav.icloud.com`; hrefs may be absolute (with `:443`) or relative.
- **Cross-host redirects drop `Authorization`** in `fetch`: follow them by hand, iCloud hosts only.
- **`If-None-Match: *`** on a create answers 412 when the UID already exists — the check sends no such header and writes over its own events instead.
- **Disconnect deletes the stored copy only**; the app-specific password stays valid until it is revoked at account.apple.com. If the delete fails, the app says so instead of reporting a disconnect.

## Log

- 29.10.2026 — Written before the first live run (Phase 1). Owner steps in `docs/deploy-checklist.md`.
- 29.10.2026 — **The Apple check, live** (the owner's iCloud): MKCALENDAR made "Lasci · Test" in purple (201); 9 of 9 events taken; 9 read back with every property kept (alert, notes, link, place, map pin, Time to Leave, Maybe, private, Free, all day, repeat, the day left out); a sync token given. On the iPhone and Mac everything showed as expected ("everything works perfectly"), except Maybe (looks like a normal event) and Private (no visible difference). An event moved on the iPhone came back through Check changes with its new day and time. Not tried: a deletion through Check changes; reading the owner's own calendars — the read test ("Read my calendars") added for that.
- 30.10.2026 — **Phase 2b-3a (migration 177): notes and alerts.** What an event's notes carry and an all-day event's alert are settings; alert "None" writes Apple's no-alert marker instead of no `VALARM`; a change to either re-sends every event already in Apple Calendar. Not run live yet: whether the iPhone honours the marker, and an all-day alert at its time.
- 30.10.2026 — **Phase 2c (migration 176): changes from the iPhone.** The drain reads each area calendar's changes first (a sync token per calendar; the first time every event): the app's own events only; moves and renames follow, a deletion lets the item go of Apple Calendar (the item stays), a repeat's day moved or deleted there becomes its own item; only a change stamped after the app's own last change; calendar names and colours come back into Settings. 503 stops a run. A PUT with no ETag in its answer asks for it. The research table above added. Not run live yet.
- 30.10.2026 — **Phase 2b-2 (migration 175): the switch per area.** Settings → Calendar → *Shows in* Google Calendar / Apple Calendar; `move` queues an area's items; the drain puts each in Apple and hands its Google copy over (only the app's own event ids), or keeps an Apple copy until its replacement exists; the timer drains every 10 minutes. `icloud_href` and `icloud_outbox.href` dropped (owner: "yes you can remove"). Not run live yet — the owner's Football test is the first.
- 30.10.2026 — **Phase 2b-1 security fix (migration 174).** The writer as first merged (173, PR #588) stored each event's iCloud address in rows the browser and the assistant can write and deleted at whatever address it found there; it was dormant (no area on Apple, no button runs it). 174 stores only the area key (`icloud_area`) and iCloud's version (`icloud_etag`); every address is built from the server-only area calendars and the item's id. `icloud_href` is emptied, never read, closed to the assistant, and kept only until the owner agrees to drop it (dropped in 175).
- 29.10.2026 — **Phase 2a** (172): the app's calendars per area (Settings → Calendar → Create in Apple Calendar; MKCALENDAR at `lasci-<area>/`, PROPPATCH for name and colour) and the password sealed with AES-GCM. Not run live yet.
- 29.10.2026 — **First live Read my calendars: "0 events from 0 calendars".** The calendar-home listing answered (207), but no calendar passed `calendarsOf`. Likely cause, not confirmed: the component check read only double quotes (`name="VEVENT"`), and XML may quote with `'` — the check now takes either. If the read still finds no calendar, the card shows what the home listed, by kind only (`listingKinds`: "collection calendar [VEVENT] ×5" — element names, never a calendar's name or address), so the next fix starts from iCloud's real answer.
