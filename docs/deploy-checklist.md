# Steps only the owner can do

A merge deploys migrations (above 140), every edge function and the website by itself (`docs/deploy-setup.md`). This file lists the steps a merge **cannot** do: secrets, dashboard switches, phone and device steps. When a change needs one, add a row in the same PR; when the owner confirms a step is done, delete its row (git keeps the history — the long per-migration list that lived in CLAUDE.md until 13.10.2026 is there too).

Rows marked **?** were open in the old list and haven't been confirmed done since.

| Status | Step | Needed for |
|---|---|---|
| ? | Supabase → Authentication → URL Configuration → Redirect URLs include the Pages URL and `http://localhost:5173/#/reset-password` | Password recovery: without them Supabase silently sends no token. |
| ? | Google Cloud → OAuth consent screen published to **Production** | A refresh token that doesn't expire after 7 days (Calendar + Tasks background sync). |
| ? | Delete the old **`google-health-sync`** function (and **`football-api`**, if still listed) under Supabase → Edge Functions | The automatic deploy adds and updates functions but never deletes one; the Fitbit sync keeps running until it is deleted. |
| ? | Health Auto Export on the iPhone: Export Version 2, Summarize on, Time Grouping **Hours**, all metrics, Since Last Sync + the weekly reconciliation, and the sleep catch-up automation `docs/health-auto-export/06-sleep-catch-up.json` | Correct Apple Health numbers and whole nights of sleep. |
| ? | Web Push tested end to end on the installed app (Settings → Notifications), with `VAPID_*` and `PUSH_CRON_SECRET` set (`docs/web-push-setup.md`) | The morning brief, release reminders and the once-per-season wish push. |
| ? | Every secret in `docs/backend/environment.md` set where it says (Edge Function secrets and/or Vault) — newest: `SHOP_PRICE_CRON_SECRET`, `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, `KOBO_SYNC_SECRET`, `KOBO_OPDS_TOKEN`, `TRAKT_SYNC_SECRET`, `TMDB_API_KEY`, `MDBLIST_API_KEY` | The feature named next to each secret; without one, that feature says it isn't configured. |
| ? | Trakt app redirect URIs: `https://lasciviens.github.io/Project_Daily/` and `http://localhost:5173/Project_Daily/` | Trakt connect. |
| ? | Games: the one-time import of the old RP5 library, and the RP6 widget's first upload of original images (`docs/termux-widgets.md`). Don't delete the RP5 Supabase project before the import is checked. | A complete Games library with every picture. |
| ? | Kobo: the latest plugin installed on the device (`docs/kobo/SETUP-PHASE-3-4.md`) | Books, Send to Kobo and Kobo control. |

If a page says "migration NNN not applied" for a migration numbered 140 or lower (those were applied by hand before the automatic deploy), tell the owner which file it is; the owner runs it in the Supabase SQL editor.
