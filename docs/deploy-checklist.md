# Steps only the owner can do

A merge deploys migrations (above 140), every edge function and the website by itself (`docs/deploy-setup.md`). This file lists the steps a merge **cannot** do: secrets, dashboard switches, phone and device steps. When a change needs one, add a row in the same PR; when the owner confirms a step is done, delete its row (git keeps the history — the long per-migration list that lived in CLAUDE.md until 13.10.2026 is there too).

| Status | Step | Needed for |
|---|---|---|
| ? | Google Cloud → APIs & Services → **Google Tasks API** enabled in the project of `GOOGLE_CLIENT_ID` | Any Google Tasks call; without it the sync line on Settings → Subscriptions says "The Google Tasks API is turned off". |
| ? | After the merge (the app syncs by itself when it opens): open Settings → Subscriptions and read the Google Tasks line under the buttons | It names what is wrong, if anything (expired sign-in, Tasks not allowed, the API turned off); a new failure also shows as a warning when the app opens. |
| ? | After the merge: Add → a Monthly plan, tick **Add to Google Calendar**, Plan it — then check Google Calendar shows it on its days (and nowhere else) | Migration 147. A monthly plan goes to Google as a list of dates (`RDATE;TZID=…`, no repeat rule); Google's docs allow it, but it was never tried on a real account. |

Every earlier step was confirmed done on 13.10.2026, and a check showed migrations 100–138 all ran.

If a page says "migration NNN not applied" for a migration numbered 140 or lower (those were applied by hand before the automatic deploy), tell the owner which file it is; the owner runs it in the Supabase SQL editor.
