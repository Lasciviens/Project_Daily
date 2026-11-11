# One item screen (Apple Calendar style) — the plan

A working mock-up was shown to the owner on 03.11.2026 ("One item screen v2", the artifact "New Item Screen" in the owner's claude.ai gallery). It was never written into the repo, so a later session didn't know about it; the owner asked on 10.11.2026 why it wasn't built. This page is the record.

**The idea:** every place that adds or opens an item (a task, a slot, a repeat, a training session, a match, an episode, a Google event) opens one screen, drawn like iOS Calendar's event screen: grouped rows under headers (Location, Time, Invitees, Options, Details, and Planning for the app's own fields), labels left, values right, fixed widths. Today there are 17 different headings.

**The owner's 11 points** (the mock-up's list): a timeline of the whole day you can drag (move the item, drag its ends); times like Apple (a wheel opens in the list, a month opens for a date, pills of one width); Starts and Ends each with their own date; Repeat with the app's day bubbles and an End Repeat row; no green line — a small Apple or Google mark on the Calendar row, red dot only when Apple refused the item; labels without a box; a mark on every row for where that field goes (Apple, Google, the app); Apple's headers, and ✨ next to the title fills the fields from a sentence; Deadline works, with a time and "Do it between"; every field from Apple and the app (table in the mock-up); one screen for every kind.

**The owner's answers (10.11.2026):**
1. Supplements keep their own schedule screen on Food.
2. Training: tapping a session opens today's training session view, with this screen as another tab — so the owner can edit this one session and/or the whole schedule.
3. Tasks without a date: "Date" switched off, filed under Inbox or Backlog — as today.
4. The marks are a setting in Settings → Calendar. Settings → Calendar itself gets simpler: a short view first, the details when a part is opened.
5. Apple's logo as the Apple mark (a private, one-person app).

**Steps** (each its own PR, after the owner's go):
1. **Done (10.11.2026)** — the screen itself, no database change. How it works: `docs/features/planning-calendar.md` → The item screen. As built: the grouped rows under Apple's headers (no Invitees until invitations work; no ✨ — step 4); Starts / Ends with their own day, stored as before as a day, a start and a length (an end on the next day is fine, at most 24 hours; moving the start moves the end); the day's timeline with its strip; the wheel and the month in the list; Repeat with the day bubbles and the next dates; the Calendar row with Apple's or Google's mark and the red dot; labels and notes without a box; Deadline → its time → Do it between; "New Item" / "Edit Item" everywhere, Add for a new item, an edit saving by itself ("Saving…", "Saved"); the marks behind Settings → Calendar → "Show where each field goes" (on by default, `calendar_prefs.prefs.showMarks`), and Settings → Calendar as a short view that opens one part at a time.
2. **Done (11.11.2026)** — Apple's extra fields: End Repeat, Alert + Second Alert, Show As (Busy / Free), URL, Travel Time. The data side (migration 193, the Apple and Google writers, both read-backs) passed a guardian review on 10.11.2026 (`AGENTS.md` → the Apple Calendar warning); the screen's rows came on 11.11.2026, only on an item with a slot or a repeat: Travel Time under Location, End Repeat under Repeat (Never / On a day / After N times, with the next dates and the last), Alert, Second Alert and Show As in Options, URL in Details (only https; ↗ shows the address before it opens). How it works: `docs/features/planning-calendar.md` → Calendar fields and The item screen. The owner's iPhone test is in `docs/deploy-checklist.md`.
3. One screen for everything: the Google event editor, the training session (as a tab, answer 2), the quick add on Work and in the search bar, Waiting for / Set parent / Move to list, Games' two copies.
4. ✨ — fill the fields from a sentence through `ai-proxy`; every field checked; nothing saves by itself; Undo.

Current screens: `docs/features/planning-calendar.md` (the Add sheet, `UnifiedPlanModal`), `docs/features/calendar-plan.md` (Apple Calendar).
