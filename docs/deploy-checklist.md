# Steps only the owner can do

A merge deploys migrations (above 140), every edge function and the website by itself (`docs/deploy-setup.md`). This file lists the steps a merge **cannot** do: secrets, dashboard switches, phone and device steps. When a change needs one, add a row in the same PR; when the owner confirms a step is done, delete its row (git keeps the history — the long per-migration list that lived in CLAUDE.md until 13.10.2026 is there too).

| Status | Step | Needed for |
|---|---|---|
| ? | Google Cloud → APIs & Services → **Google Tasks API** enabled in the project of `GOOGLE_CLIENT_ID` | Any Google Tasks call; without it the sync line on Settings → Subscriptions says "The Google Tasks API is turned off". |
| ? | After the merge with migration 145: Settings → Subscriptions → Google → **Sync now**, then read the line under the buttons | Google tasks in the app again; the line names what is wrong (expired sign-in, Tasks not allowed, the API turned off). |

Every earlier step was confirmed done on 13.10.2026, and a check showed migrations 100–138 all ran.

If a page says "migration NNN not applied" for a migration numbered 140 or lower (those were applied by hand before the automatic deploy), tell the owner which file it is; the owner runs it in the Supabase SQL editor.
