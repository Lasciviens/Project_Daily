# Calendar plan — Apple first

The owner's wishes for the app's calendar, written down on 29.10.2026 so the context isn't lost between sessions. **Approved so far:** Phase 1 (done) and Phase 2 (29.10.2026, step by step); Phase 3 waits for the owner's go. How the iCloud connection works: `docs/integrations/icloud-caldav.md`. What is built today: `docs/features/planning-calendar.md`.

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
| 20 | A default alert per calendar | First: "something I can solve on my own" (the double alert from Google). Then decided for Phase 2: a default alert per area, the owner's setting (Settings → Calendar); with iCloud direct the double alert goes away |
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

## Decisions (owner, 29.10.2026, "Go" for Phase 2)

- **Roles:** iCloud is the **only place the app writes** its events (Apple Calendar). Google is **read-only for calendars** — the Google account the app is connected to is the one that holds the shared family calendars. **Google Tasks stays exactly as it is** (the owner uses it).
- **Never the same event in both:** an iCloud copy first, confirmed, then the Google Calendar copy is removed (the item stays in the app).
- **Five calendars:** Training · Work (with Projects) · Personal (tasks, repeats) · Media (episodes, films) · Football.
- **A default alert per area:** Training 60 min, Football 15 min, Work 10 min, Personal and Media none.
- **Emoji per area** in front of event titles (🏋️ Lower B, ⚽ a match, 📺 an episode).
- **Every choice is a setting** — "Add those to the settings as well, and other settings that you are coding but I couldn't change without asking you": each calendar's name, emoji, colour, default alert and whether it is used; which area an item goes to; what an event's notes carry. Values above are only the defaults.

## Phases

**Phase 1 — the Apple check (done, 29.10.2026).** Connect with an app-specific password; the app made a test calendar, wrote 9 test events, read them back and followed an event moved on the iPhone. Everything worked except Maybe and Private (no visible effect). Then **Read my calendars** (read-only): the owner's iCloud calendar reads; subscriptions, Google and work calendars don't (table above). Still to try: a deleted event through Check changes; whether iCloud splits repeating events into days.

**Phase 2 — the app's calendars in iCloud (approved 29.10.2026: "Go").** Items 19, 35, 24, 4, 3, 5, 6, 7 (12 by its fallback). Four steps, each its own PR, each checked by the owner before the next:

- **2a · Settings and the five calendars** (built 29.10.2026, migration 172). A **Calendar** tab in Settings: each area's name, emoji, colour, default alert and on/off (the defaults above). **Create in Apple Calendar** makes the area calendars in iCloud, or brings an existing one's name and colour up to date. The app-specific password is stored encrypted (AES-GCM, a key held as an Edge Function secret — one owner step). No event moves yet.
- **2b · Writing to iCloud.** A setting "The app's calendar: Google / Apple" — Google until 2d. With Apple, every timed slot and repeating plan is written to its area's iCloud calendar by the server (an outbox like Google's `calendar_outbox`, drained every few minutes and right after a save): the title with the area's emoji, the area's alert, plain-text notes with a link back, the location. A repeating plan is one series, mapped exactly like Google's (`calendarSeries.ts`, mirrored into the function and checked). The sheet's chip says "Apple Calendar". Settings added: which kind of item goes to which area (Games have no area of their own yet), what the notes carry.
  **2b design (30.10.2026).** Two PRs, so nothing changes for the owner until an area is switched:
  - **2b-1 — the writer, dormant** (built 30.10.2026). PR #588 (migration 173) was merged and deployed before its security review's fixes landed — still dormant, but storing event addresses in rows the browser and the assistant can write; migration 174 and the function update fix it (the warning in `AGENTS.md`). As fixed, migrations 173 + 174: `time_blocks` and `schedule_blocks` store only **which area calendar** an item's event is in (`icloud_area`) and iCloud's version of it (`icloud_etag`), a series also its start day and horizon — never an address: the function builds the address from its own server-only record of the area calendars and the item's id, so no browser or assistant write can steer a delete elsewhere (security review, 30.10.2026; the warning in `AGENTS.md`). `icloud_outbox` (service role only, owner lock, in `app_undo_outbox`); triggers on `time_blocks`, `schedule_blocks` and `tasks` queue a change only when an area is on Apple or the item already has an Apple event, and a change in Settings → Calendar re-queues the events already in that area. `icloud-calendar`'s `drain` (one at a time per account, a short lease) reads each queued item live; when it wants a calendar (its Google choice is Calendar or Both) and its area is on Apple, it PUTs the ONE event — the same rules as Google's events (`blockEventBody`, `seriesEventFor`, generated in by `scripts/sync-icloud-shared.mjs`) plus the area's emoji, alert and a link back — with If-Match, so a change made on the iPhone is never written over; otherwise it removes the event. The new copy first, then the old; a missing area calendar keeps the row waiting. Nothing is on Apple yet, so nothing is written.
  - **2b-2 — the switch** (built 30.10.2026, migration 175). Settings → Calendar per area: **Shows in: Google Calendar / Apple Calendar** (Apple once iCloud is connected; an area not in use stays on Google). Changing it opens a popup before anything moves: what each area moves ("12 events and 2 repeating plans" — to Apple *from today on* by default, or *every day*; past days stay in Google Calendar and move when changed), then **Move** saves, makes the calendars, moves and shows "Moving… 8 of 14", and says in one line where everything is (a warning when something stayed behind). The rule both ways is the owner's — the new copy first, confirmed, then the old one goes:
    - **To Apple:** `icloud-calendar`'s `move` queues the area's items that want a calendar; the drain puts each in Apple Calendar, then hands its Google Calendar copy to Google's own delete queue (`calendar_outbox`) in one database step, `icloud_hand_over` — only an event id the app made from that item's own id (a forged or Google-picked id stays in Google Calendar and is counted, never deleted; the warning in `AGENTS.md`). `google-tasks-sync` runs once at the end, so the Google copies go at once.
    - **Back to Google:** the browser makes each item's Google Calendar copy (a series keeps the start it had in Apple), and the drain removes the Apple copy of each one Google confirmed — an Apple copy stays until then (175: the Google copy appearing queues the item). One Google doesn't take stays in Apple Calendar and is counted.
    - **Afterwards:** an item in an Apple area never gets a Google Calendar event from the browser (`linkBlockCalendarEvent` and `linkScheduleSeries` ask `appleAreas.appleAreaOf` first); its save sends the queue at once and confirms by the row's `icloud_area` (`itemCalendar.settleItemApple`) — only then does an old Google Task go, and an Apple copy of an item moved to Google Tasks stays until its Google Task exists. The sheet's chip says "Apple Calendar · busy" (Both: "Google Tasks + Apple Calendar"; none: "Only in this app"). A tick, a repeat's day and the app's opening send the queue too; a pg_cron timer every 10 minutes catches the rest (`ICLOUD_SYNC_SECRET`, an owner step). An older item (no Google choice stored) whose copy is in Apple reads as on Calendar (`presentGoogleTarget`, `repeat_day_presence`) — no data written for it.
    - The retired `icloud_href` / `icloud_outbox.href` columns are dropped (owner, 30.10.2026: "yes you can remove").
  - **2b-3 — the remaining settings** (next, from the 2b-1 review): which kind of item goes to which area (today `icloudEvents.itemArea`: football → training → media → work → personal), what an event's notes carry, and whether an all-day event gets the area's alert (today: none) — the owner's choices, not constants; a live check of a plan saved in another time zone (iCloud gets a `TZID` without a time-zone block for any zone but Oslo — *to confirm*); and the location, which no slot keeps yet. Until 2c, a change made on the iPhone stays in Apple Calendar and the app's later change to that item waits (If-Match answered 412) instead of overwriting it.
- **2c · Changes from the iPhone.** Moves, renames and deletions made on the iPhone come back (a sync token per calendar), under the same rules as Google's read-back: only the app's own events, baselines first, a deletion takes the item off the calendar but never deletes the item, the token moves only when everything applied. A calendar renamed or recoloured on the iPhone comes back into Settings → Calendar too (owner, 30.10.2026: "Can it sync when I change from app or calendar?"), so the next update never paints over it.
- **2d · The move** — folded into 2b-2 (built there, per area, both ways). Google Tasks is untouched.

**Phase 3 — planning with time (proposed).** Items 21, 32, 33: find a free time (from every calendar the app can read), travel time before an event, and a weekly planned vs. done.

**Later, by the owner's word:** 15 (working location), 17 (instant sync).
