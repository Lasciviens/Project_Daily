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
1. The screen itself — no database change.
2. Apple's extra fields: End Repeat, Alert + Second Alert, Show As (Busy / Free), URL, Travel Time — migrations, the Apple Calendar writer, a guardian review (`AGENTS.md` → the Apple Calendar warning).
3. One screen for everything: the Google event editor, the training session (as a tab, answer 2), the quick add on Work and in the search bar, Waiting for / Set parent / Move to list, Games' two copies.
4. ✨ — fill the fields from a sentence through `ai-proxy`; every field checked; nothing saves by itself; Undo.

Current screens: `docs/features/planning-calendar.md` (the Add sheet, `UnifiedPlanModal`), `docs/features/calendar-plan.md` (Apple Calendar).
