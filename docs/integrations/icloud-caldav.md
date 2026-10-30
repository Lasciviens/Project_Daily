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

## Fields we read

The read-back looks only for the properties above (present or not, and their values) in what `calendar-multiget` returns; Check changes reads each changed event's `SUMMARY` and `DTSTART` (a UTC time is shown on the Oslo clock). Stored in Phase 1: the test calendar's URL (saved before any event is written, so Remove can always find them), its sync token, and the last check's result (`last_check`: the steps, the calendar's name, the day, and per event what iCloud kept — no password, no URL), so the card still shows what to look for after the owner comes back from the Calendar app.

**Read my calendars** (read-only, owner 29.10.2026) reads each calendar's `displayname`, `resourcetype`, `apple:calendar-color` (a `#RRGGBB` only, else none) and `supported-calendar-component-set`, and per event `SUMMARY`, `DTSTART` (with its `TZID`), `RRULE`, `RECURRENCE-ID`, `STATUS` (a cancelled one is left out) and whether it has an `ORGANIZER`/`ATTENDEE` (an invitation). A start is shown on the Oslo clock: UTC and any zone the runtime knows are converted; a floating time and an unknown zone (a Windows name) are shown as written, with the zone named. Nothing of it is stored or logged — the titles go only to the owner's browser, and the card forgets them on reload.

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
- 29.10.2026 — **Phase 2a** (172): the app's calendars per area (Settings → Calendar → Create in Apple Calendar; MKCALENDAR at `lasci-<area>/`, PROPPATCH for name and colour) and the password sealed with AES-GCM. Not run live yet.
- 29.10.2026 — **First live Read my calendars: "0 events from 0 calendars".** The calendar-home listing answered (207), but no calendar passed `calendarsOf`. Likely cause, not confirmed: the component check read only double quotes (`name="VEVENT"`), and XML may quote with `'` — the check now takes either. If the read still finds no calendar, the card shows what the home listed, by kind only (`listingKinds`: "collection calendar [VEVENT] ×5" — element names, never a calendar's name or address), so the next fix starts from iCloud's real answer.
