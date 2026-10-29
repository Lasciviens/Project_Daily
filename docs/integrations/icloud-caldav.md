# iCloud Calendar (CalDAV)

Checked: 29.10.2026 against the CalDAV standard (RFC 4791 calendar access, RFC 6578 sync-collection, RFC 5545 iCalendar), Apple's support pages on app-specific passwords (support.apple.com/102654, support.apple.com/121539) and published iCloud CalDAV guides (cli.nylas.com/guides/icloud-caldav-settings; tsdav's iCloud notes). **No live sample yet** — there are no credentials in a development session. Phase 1 ("Apple check", owner 29.10.2026) is that sample: it writes test events to the owner's iCloud, reads back what iCloud kept, and the owner reports what the iPhone and Mac show. Every line marked *(to confirm)* below is settled by that run and then rewritten here with the date.

Why: the owner uses Google Calendar only to reach Apple Calendar ("our main focus should be on how Apple will handle it"). Apple Calendar shows Google events only partly (no event colour, notes as raw HTML on some iPhones, double alerts). iCloud is Apple's own calendar store; CalDAV is the protocol Apple's own Mac Calendar, Outlook, Thunderbird, BusyCal and DAVx5 use for it. Apple offers no other calendar API (no REST, no developer keys); Apple's support page names app-specific passwords as the way "apps made by developers other than Apple" sign in to iCloud Mail, Calendar and Contacts.

## How we authenticate

- **App-specific password.** The owner makes one at account.apple.com (Sign-In and Security → App-Specific Passwords; needs two-factor authentication) and enters it with the Apple ID email in Settings → Subscriptions → Apple Calendar (iCloud). The normal Apple ID password does not work for CalDAV.
- **Stored on the server only**: `icloud_credentials` (migration 171 — service role only, `REVOKE ALL … FROM anon, authenticated`, never in `ai-proxy`'s catalog). The browser never reads it back; it sees only derived status from the `icloud-calendar` function (connected, the email with its middle masked, when, the last problem). Never logged; mutations that carry it set `logPayload: false`.
- **What it opens**: iCloud Mail, Contacts and Calendars of that Apple ID (not Photos, Drive, payments or account changes). The app only ever calls CalDAV. Revoke: account.apple.com → App-Specific Passwords; changing the Apple ID password revokes every app-specific password. Disconnect in the app deletes the stored copy only — say so.
- **HTTP Basic** over HTTPS (`Authorization: Basic base64(email:password)`) on every request. Apple's newer "authorise with your Apple Account" flow (no password) is offered only to "supported third-party apps" Apple doesn't name — not available to us.
- **Credentials never leave iCloud's hosts**: every URL the function calls — including any `href` or `Location` iCloud answers with — must be `https://` and end in `.icloud.com` (`isICloudUrl`); redirects are followed by hand (`redirect: 'manual'`), because `fetch` drops `Authorization` on a cross-host redirect and an unchecked one could carry it elsewhere.

## Endpoints we call

Base `https://caldav.icloud.com`. Each account's calendars live on its own partition host (`https://pNN-caldav.icloud.com:443/<id>/calendars/`), learned by discovery.

| Request | When | Notes |
|---|---|---|
| `PROPFIND /` (`Depth: 0`, `current-user-principal`) | Connect | 401 = wrong email / not an app-specific password. Answer: the principal's href |
| `PROPFIND <principal>` (`Depth: 0`, `C:calendar-home-set`) | Connect | the calendar home (often on the `pNN-caldav` host) — stored |
| `PROPFIND <home>` (`Depth: 1`, `displayname`, `resourcetype`, `apple:calendar-color`) | the check | finds "Lasci · Test" when MKCALENDAR isn't allowed |
| `MKCALENDAR <home>lasci-test/` (`displayname`, `apple:calendar-color`, `C:supported-calendar-component-set` VEVENT) | the check | *(to confirm)* that iCloud lets a third-party client make a calendar; if not, the owner makes "Lasci · Test" on the iPhone and the check finds it by name |
| `PUT <calendar>/<uid>.ics` (`Content-Type: text/calendar; charset=utf-8`, `If-None-Match: *` to create) | the check | one VEVENT per object; UID unique in the calendar |
| `REPORT <calendar>` `calendar-multiget` (the hrefs written) | the check | what iCloud kept of each event (`calendar-data`, `getetag`) |
| `PROPFIND <calendar>` (`Depth: 0`, `sync-token`) then `REPORT <calendar>` `sync-collection` (`sync-token`, `sync-level 1`, `getetag`) | the check / Check changes | *(to confirm)* RFC 6578 on iCloud: changed hrefs (200) and deleted ones (404) since the token, and a new token |
| `DELETE <calendar>` | Remove the test calendar | the collection and every event in it |

## Fields we write (the check's events)

All in one `VCALENDAR` (`VERSION:2.0`, `PRODID:-//Lasci's Board//Apple check//EN`), lines folded at 75 octets, text escaped (`\\`, `\;`, `\,`, `\n`).

| Property | What it should do on Apple *(to confirm)* |
|---|---|
| `UID`, `DTSTAMP`, `DTSTART`/`DTEND` (UTC `…Z`, or `TZID=Europe/Oslo` with a `VTIMEZONE` for the repeating one; `VALUE=DATE` all-day) | the event at the right time |
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

The read-back looks only for the properties above (present or not, and their values) in what `calendar-multiget` returns; Check changes reads each changed event's `SUMMARY` and `DTSTART`. Nothing from iCloud is stored in Phase 1 except the test calendar's URL and its sync token.

## Fields deliberately not used (Phase 1)

- `ATTACH` — the owner dropped attachments (11).
- `ATTENDEE` / `ORGANIZER` — the events are the owner's own; an attendee makes iCloud send invitation mail.
- Reminders (`VTODO`) — Apple's Reminders left CalDAV in iOS 13 ("a private silo that only the Apple Reminders app can access"); reaching them takes a script on the device (Scriptable / Shortcuts).

## Traps (known before the first run)

- **No push.** iCloud has no webhook; changes come only by asking (`sync-collection`), so "from the iPhone to the app" is as fast as the polling interval.
- **No developer support or published limits.** Apple doesn't document rate limits for CalDAV; keep requests few and back off on 429/503.
- **The partition host.** The calendar home is on `pNN-caldav.icloud.com`, not `caldav.icloud.com`; hrefs may be absolute (with `:443`) or relative.
- **Cross-host redirects drop `Authorization`** in `fetch`: follow them by hand, iCloud hosts only.
- **`If-None-Match: *`** on a create answers 412 when the UID already exists — the check deletes its old events first (Remove) or writes over them without the header.

## Log

- 29.10.2026 — Written before the first live run (Phase 1). Owner steps in `docs/deploy-checklist.md`.
