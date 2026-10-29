# iCloud Calendar (CalDAV)

Checked: 29.10.2026 against the CalDAV standard (RFC 4791 calendar access, RFC 6578 sync-collection, RFC 5545 iCalendar), Apple's support pages on app-specific passwords (support.apple.com/102654, support.apple.com/121539) and published iCloud CalDAV guides (cli.nylas.com/guides/icloud-caldav-settings; tsdav's iCloud notes). **No live sample yet** — there are no credentials in a development session. Phase 1 ("Apple check", owner 29.10.2026) is that sample: it writes test events to the owner's iCloud, reads back what iCloud kept, and the owner reports what the iPhone and Mac show. Every line marked *(to confirm)* below is settled by that run and then rewritten here with the date.

Why: the owner uses Google Calendar only to reach Apple Calendar ("our main focus should be on how Apple will handle it"). Apple Calendar shows Google events only partly (no event colour, notes as raw HTML on some iPhones, double alerts). iCloud is Apple's own calendar store; CalDAV is the protocol Apple's own Mac Calendar, Outlook, Thunderbird, BusyCal and DAVx5 use for it. Apple offers no other calendar API (no REST, no developer keys); Apple's support page names app-specific passwords as the way "apps made by developers other than Apple" sign in to iCloud Mail, Calendar and Contacts.

## How we authenticate

- **App-specific password.** The owner makes one at account.apple.com (Sign-In and Security → App-Specific Passwords; needs two-factor authentication) and enters it with the Apple ID email in Settings → Subscriptions → Apple Calendar (iCloud). The normal Apple ID password does not work for CalDAV.
- **Stored on the server only**: `icloud_credentials` (migration 171 — service role only, `REVOKE ALL … FROM anon, authenticated`, never in `ai-proxy`'s catalog). The browser never reads it back; it sees only derived status from the `icloud-calendar` function (connected, the email with its middle masked, when, the last problem). Never logged; mutations that carry it set `logPayload: false`. The function reads the password only for the actions that call iCloud (check, changes, remove).
- **Plain text in Phase 1** (a test that ends with the password revoked). Before Phase 2 keeps it for good: encrypt it in the function (AES-GCM with a key held as an Edge Function secret), so a database dump alone doesn't open the calendar.
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
| `MKCALENDAR <home>lasci-test/` (`displayname`, `apple:calendar-color`, `C:supported-calendar-component-set` VEVENT) | the check | *(to confirm)* that iCloud lets a third-party client make a calendar. 201 = made. 405 = something is there already: a `PROPFIND` (`Depth: 0`) counts it only when it is a calendar called "Lasci · Test" |
| `PROPFIND <home>` (`Depth: 1`, `displayname`, `resourcetype`) | the check, when MKCALENDAR didn't give the test calendar | finds a calendar the owner made on the iPhone called "Lasci Test" — case and punctuation ignored (`isTestCalendarName`), since the iPhone keyboard has no easy "·" |
| `PUT <calendar>/<uid>.ics` (`Content-Type: text/calendar; charset=utf-8`, no `If-None-Match`) | the check | one VEVENT per object; UID unique in the calendar. A second run writes over the first (201 new, 204 replaced) |
| `REPORT <calendar>` `calendar-multiget` (the hrefs written) | the check | what iCloud kept of each event (`calendar-data`, `getetag`) |
| `PROPFIND <calendar>` (`Depth: 0`, `sync-token`) then `REPORT <calendar>` `sync-collection` (`Depth: 0`, `sync-token`, `sync-level 1`, `getetag`) | the check / Check changes | *(to confirm)* RFC 6578 on iCloud: changed hrefs (200) and deleted ones (404) since the token, and a new token |
| `PROPFIND <calendar>` (`Depth: 1`, `getetag`) then `DELETE <calendar>` | Remove the test calendar | the whole calendar goes only when it is the app's own `lasci-test/` and holds nothing but the check's events (`lasci-check-<key>-lasciviens-github-io.ics`); otherwise only the check's events are deleted, one by one. The answer says which (`removed: 'calendar' \| 'events'`), and so do the question and the toast |

## Fields we write (the check's events)

All in one `VCALENDAR` (`VERSION:2.0`, `PRODID:-//Lasci's Board//Apple check//EN`), lines folded at 75 octets, text escaped (`\\`, `\;`, `\,`, `\n`).

| Property | What it should do on Apple *(to confirm)* |
|---|---|
| `UID` (`lasci-check-<key>@lasciviens.github.io`), `DTSTAMP` (UTC), `DTSTART`/`DTEND` (`TZID=Europe/Oslo` with a `VTIMEZONE` in each object; `VALUE=DATE` all-day) | the event at the right time, also across summer time |
| `SUMMARY` | the title |
| `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT10M`) | an alert 10 minutes before — once, not twice |
| `DESCRIPTION` (plain text, several lines) | Notes, line breaks kept |
| `URL` | Apple's URL field, a tappable link back to the app |
| `LOCATION` + `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=…;X-TITLE="…":geo:lat,lon` (a public place: Oslo S) + `X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC` | a map pin; "Time to Leave" alerts. Apple's own extensions — no public spec; the read-back shows whether iCloud keeps them |
| `STATUS:TENTATIVE` | "Maybe" |
| `CLASS:PRIVATE` | Private |
| `TRANSP:TRANSPARENT` | Free (doesn't block time) |
| `RRULE:FREQ=DAILY;COUNT=4` + `EXDATE` (one day left out) | a repeating event with a day taken out |
| calendar `apple:calendar-color` (`#RRGGBBAA`) | the calendar's colour on every Apple device |

## Fields we read

The read-back looks only for the properties above (present or not, and their values) in what `calendar-multiget` returns; Check changes reads each changed event's `SUMMARY` and `DTSTART` (a UTC time is shown on the Oslo clock). Stored in Phase 1: the test calendar's URL (saved before any event is written, so Remove can always find them), its sync token, and the last check's result (`last_check`: the steps, the calendar's name, the day, and per event what iCloud kept — no password, no URL), so the card still shows what to look for after the owner comes back from the Calendar app.

## Fields deliberately not used (Phase 1)

- `ATTACH` — the owner dropped attachments (11).
- `ATTENDEE` / `ORGANIZER` — the events are the owner's own; an attendee makes iCloud send invitation mail.
- Reminders (`VTODO`) — Apple's Reminders left CalDAV in iOS 13 ("a private silo that only the Apple Reminders app can access"); reaching them takes a script on the device (Scriptable / Shortcuts).

## Traps (known before the first run)

- **No push.** iCloud has no webhook; changes come only by asking (`sync-collection`), so "from the iPhone to the app" is as fast as the polling interval.
- **No developer support or published limits.** Apple doesn't document rate limits for CalDAV; keep requests few and back off on 429/503.
- **The partition host.** The calendar home is on `pNN-caldav.icloud.com`, not `caldav.icloud.com`; hrefs may be absolute (with `:443`) or relative.
- **Cross-host redirects drop `Authorization`** in `fetch`: follow them by hand, iCloud hosts only.
- **`If-None-Match: *`** on a create answers 412 when the UID already exists — the check sends no such header and writes over its own events instead.
- **Disconnect deletes the stored copy only**; the app-specific password stays valid until it is revoked at account.apple.com. If the delete fails, the app says so instead of reporting a disconnect.

## Log

- 29.10.2026 — Written before the first live run (Phase 1). Owner steps in `docs/deploy-checklist.md`.
