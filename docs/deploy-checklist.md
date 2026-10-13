# Steps only the owner can do

A merge deploys migrations (above 140), every edge function and the website by itself (`docs/deploy-setup.md`). This file lists the steps a merge **cannot** do: secrets, dashboard switches, phone and device steps. When a change needs one, add a row in the same PR; when the owner confirms a step is done, delete its row (git keeps the history — the long per-migration list that lived in CLAUDE.md until 13.10.2026 is there too).

Rows marked **?** were open in the old list and haven't been confirmed done since.

| Status | Step | Needed for |
|---|---|---|
| ? | Supabase → Authentication → URL Configuration → Redirect URLs include `https://lasciviens.github.io/Project_Daily/#/reset-password` and `http://localhost:5173/Project_Daily/#/reset-password` | Password recovery: without them Supabase silently sends no token. |
| ? | Google Cloud → OAuth consent screen published to **Production** | A refresh token that doesn't expire after 7 days (Calendar + Tasks background sync). |
| ? | Delete the old **`google-health-sync`** function (and **`football-api`**, if still listed) under Supabase → Edge Functions | The automatic deploy adds and updates functions but never deletes one; the Fitbit sync keeps running until it is deleted. |
| ? | Health Auto Export on the iPhone: Export Version 2, Summarize on, Time Grouping **Hours**, all metrics, Since Last Sync + the weekly reconciliation, and the sleep catch-up automation `docs/health-auto-export/06-sleep-catch-up.json` | Correct Apple Health numbers and whole nights of sleep. |
| ? | Web Push tested end to end on the installed app (Settings → Notifications), with `VAPID_*` and `PUSH_CRON_SECRET` set (`docs/web-push-setup.md`) | The morning brief, release reminders and the once-per-season wish push. |
| ? | Every secret in `docs/backend/environment.md` set where it says (Edge Function secrets and/or Vault) — newest: `SHOP_PRICE_CRON_SECRET`, `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, `KOBO_SYNC_SECRET`, `KOBO_OPDS_TOKEN`, `TRAKT_SYNC_SECRET`, `TMDB_API_KEY`, `MDBLIST_API_KEY` | The feature named next to each secret; without one, that feature says it isn't configured. |
| ? | Trakt app redirect URIs: `https://lasciviens.github.io/Project_Daily/` and `http://localhost:5173/Project_Daily/` | Trakt connect. |
| ? | Games: the one-time import of the old RP5 library, and the RP6 widget's first upload of original images (`docs/termux-widgets.md`). Don't delete the RP5 Supabase project before the import is checked. | A complete Games library with every picture. |
| ? | Kobo: the latest plugin installed on the device (`docs/kobo/SETUP.md`) | Books, Send to Kobo and Kobo control. |
| ? | Migrations 100–138 were applied by hand; the automatic deploy only proves 139 and 140 ran. Run the query below once in the Supabase SQL editor (it only reads) and tell Claude which rows say `false`. | Every feature that names a migration; a missing one shows "migration NNN not applied". |

**Which hand-applied migrations ran** — one row per migration, `true` when its first new table, column or function exists. 103 and 130 only repair data and 132 only rewrites two functions, so they have no row; if the row before and after says `true`, they most likely ran too.

```sql
with c as (select table_name || '.' || column_name as tc from information_schema.columns where table_schema = 'public'),
f as (select proname, prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
select migration, ran from (values
  ('100', exists (select from c where tc = 'game_platforms.esde_assets')),
  ('101', exists (select from c where tc = 'psn_tokens.npsso_expires_at')),
  ('102', exists (select from pg_constraint where conrelid = to_regclass('public.games') and pg_get_constraintdef(oid) ilike '%hidden%')),
  ('104', to_regclass('public.screenscraper_prefs') is not null),
  ('105', exists (select from c where tc = 'games.provider_kind')),
  ('106', exists (select from f where proname = 'recompute_recipe_macros')),
  ('107', exists (select from f where proname = 'trg_recipes_keep_log_title')),
  ('108', exists (select from f where proname = 'game_storage_usage')),
  ('109', exists (select from f where proname = 'game_storage_usage' and prosrc ilike '%scrape_record%')),
  ('110', exists (select from c where tc = 'athlete_profile.birth_year')),
  ('111', exists (select from c where tc = 'athlete_profile.goal_weight_kg')),
  ('112', to_regclass('public.training_skips') is not null),
  ('113', exists (select from c where tc = 'day_targets.phase_start_date')),
  ('114', exists (select from c where tc = 'dev_requests.completed_at')),
  ('115', to_regclass('public.service_subscriptions') is not null),
  ('116', exists (select from c where tc = 'movies.trakt_id')),
  ('117', exists (select from c where tc = 'trakt_sync_state.sync_started_at')),
  ('118', exists (select from c where tc = 'movies.letterboxd_rating')),
  ('119', to_regclass('public.media_follows') is not null),
  ('120', to_regclass('public.movie_cinema_visits') is not null),
  ('121', exists (select from c where tc = 'games.igdb_id')),
  ('122', to_regclass('public.media_release_reminders') is not null),
  ('123', exists (select from f where proname = 'replace_recipe_ingredients')),
  ('124', exists (select from c where tc = 'trakt_sync_state.imported_at')),
  ('125', to_regclass('public.book_deliveries') is not null),
  ('126', to_regclass('public.books') is not null),
  ('127', exists (select from c where tc = 'books.kind')),
  ('128', exists (select from c where tc = 'books.categories')),
  ('129', exists (select from f where proname = 'stamp_task_closed_at')),
  ('131', exists (select from f where proname = 'merge_games')),
  ('133', to_regclass('public.games_prefs') is not null),
  ('134', exists (select from c where tc = 'shop_items.bought_at')),
  ('135', to_regclass('public.calendar_outbox') is not null),
  ('136', exists (select from c where tc = 'trakt_sync_state.notes_synced_at')),
  ('137', exists (select from c where tc = 'shop_items.price_min')),
  ('138', exists (select from c where tc = 'shop_items.chain_name'))
) as v(migration, ran)
order by migration;
```

If a page says "migration NNN not applied" for a migration numbered 140 or lower (those were applied by hand before the automatic deploy), tell the owner which file it is; the owner runs it in the Supabase SQL editor.
