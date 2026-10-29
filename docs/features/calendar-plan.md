# Calendar plan — Apple first

The owner's wishes for the app's calendar, written down on 29.10.2026 so the context isn't lost between sessions. **Nothing past Phase 1 is approved:** each phase waits for the owner's go. How the iCloud connection works: `docs/integrations/icloud-caldav.md`. What is built today: `docs/features/planning-calendar.md`.

## What the owner wants

- **Apple Calendar is the goal; Google is only a bridge.** "I don't use Google Calendar actually. I just need it to sync with Apple Calendar … our main focus should be on how Apple will handle it." Since 29.10.2026 the app talks to iCloud directly (CalDAV, an app-specific password), so Google may not be needed at all for this.
- **It must work as well as Google did.** "I have to be sure that iCloud Calendar would work as good as Google Calendar" — the reason for the Phase 1 test before anything is moved.
- **Nothing hard-coded** to the owner's account, calendars or a guess about Apple's answers: the app reads everything from iCloud (where the calendars live, their names, colours, events) and handles the standard in general.
- **Few phases.** "Parse it to phases (as less as possible)."
- **Past days are a record.** Nothing clears old tasks or days in bulk (`.claude/rules/tasks.md`); the Diary (Personal → Diary) is the day's log.

## The owner's picks from the feature list (29.10.2026)

From the list of Google Calendar features, kept here by number so later sessions can talk about them the same way:

| # | Feature | Decision |
|---|---|---|
| 3 | An alert per event (e.g. Training 60 min before) | Wanted |
| 4 | Colours | Wanted — on Apple only a **calendar's** colour shows, so this comes with 19 |
| 5 | A description (notes) written by the app — a session's exercises, match details | Wanted, plain text |
| 6 | Location (gym, stadium) with a map | Wanted — iCloud keeps Apple's map pin and "Time to Leave" (confirmed 29.10.2026) |
| 7 | A link back to the item in the app | Wanted — Apple's URL field works (confirmed) |
| 11 | Attachments | **Dropped** ("we can skip 11") |
| 12 | Maybe / private | Wanted, but on Apple's devices neither shows any difference for the owner's own events (Apple check, 29.10.2026). Fallback to decide: a "Maybe" calendar, or a "?" in the title |
| 15 | Working location (home / office) | **Later** — "let's talk about this later" |
| 17 | Instant sync | **Later** — iCloud has no push; changes come by asking every few minutes |
| 19 | The app's own calendars, one per area | Wanted — the core of Phase 2 |
| 20 | A default alert per calendar | The owner handles alerts on the phone ("something I can solve on my own"); with iCloud direct, the double alert from Google goes away |
| 21 | Free/busy: find a free time | Wanted (Phase 3) |
| 24 | Calendar colours in the app's own agenda | Wanted, with 19 |
| 28 | Clear completed tasks | **Not applied** — turned into the rule "past days are never cleared" |
| 32 | Travel time before an event | Wanted (Phase 3): Apple's Time to Leave, or a travel event built from the app's Entur trips |
| 33 | Planned vs. done | Wanted (Phase 3) |
| 35 | One calendar per area, a small colour set, emoji in titles | Wanted, with 19 |

Also asked for on 29.10.2026:
- **Diary** under Personal: "what, where, with whom and when I have eaten, watched, played, trained, planned, done tasks … and a text where I speak about my day". Built (migration 170, `docs/features/daily.md`); "where" and "with whom" live in the owner's own words for now.
- **Invitations**: can the app invite someone, or send an invitation the owner can answer with Maybe? Proposed, not built: an "invite test" (the app invites one of the owner's other addresses, the owner answers Maybe there, Check changes reads the answer back). The owner can't answer an event they organise themselves, which is likely why "Maybe" showed nothing.
- **Apple Reminders**: not reachable from a server (closed to sync since iOS 13); only a script on the iPhone (Scriptable / Shortcuts) can write them.

## What the app can read (29.10.2026)

The owner's Apple Calendar shows several accounts side by side; the iCloud connection reaches only one of them.

| On the iPhone | Where it really lives | Can the app read it? |
|---|---|---|
| The owner's own iCloud calendars | iCloud | **Yes** — Read my calendars read it (the first run, after the fix in #585) |
| Calendars subscribed to in iCloud (sport fixtures, name days, holidays) | A public feed (webcal / .ics) that iCloud only points to | **Not yet** — they are probably listed as "subscribed", not as calendars; their feed could be read from its address (server-side, through the SSRF guard) |
| A Google account's calendars, including ones shared with it | Google | **Not through iCloud** — only through the Google API (the app's Google connection, if it is that account) |
| A work account (Outlook / Exchange) | Microsoft | **Not through iCloud** — only through Microsoft Graph (an employer can block third-party apps), a published .ics link if work allows one, or a script on the iPhone (Scriptable reads every calendar the phone shows) |

This matters for Phase 3: "find a free time" is only as good as the calendars the app can see.

## Phases

**Phase 1 — the Apple check (done, 29.10.2026).** Connect with an app-specific password; the app made a test calendar, wrote 9 test events, read them back and followed an event moved on the iPhone. Everything worked except Maybe and Private (no visible effect). Then **Read my calendars** (read-only): the owner's iCloud calendar reads; subscriptions, Google and work calendars don't (table above). Still to try: a deleted event through Check changes; whether iCloud splits repeating events into days.

**Phase 2 — the app's calendars in iCloud (proposed, not approved).** Items 19, 35, 24, 4, 3, 5, 6, 7 (12 by its fallback):
- The app makes one iCloud calendar per area, each with its colour, and puts its slots and repeating plans there instead of Google.
- Each event carries its alert, plain-text notes (a session's exercises, match details), a link back to the app, and a location with a map pin.
- Changes made on the iPhone come back by asking iCloud every few minutes (sync token), like Google's read-back today.
- A migration so every slot and plan knows its iCloud calendar and event; the app-specific password encrypted before it is kept for good.
- Questions for the owner first: which calendars (proposal: Training · Work · Personal · Media · Football), emoji in titles, a default alert per area, and what happens to Google (keep as a backup, or switch off once iCloud works).

**Phase 3 — planning with time (proposed).** Items 21, 32, 33: find a free time (from every calendar the app can read), travel time before an event, and a weekly planned vs. done.

**Later, by the owner's word:** 15 (working location), 17 (instant sync).
