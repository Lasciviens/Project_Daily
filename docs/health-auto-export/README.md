# Health Auto Export — importable automation configs

These are importable automation configs for the **Health Auto Export** iOS app,
pre-filled to talk to `health-export-webhook`. Health Auto Export supports
importing an automation from a JSON file matching its own export/settings
format — these were built by hand from a real exported automation config, not
from Health Auto Export's own "share automation" feature, so **double-check
each one after importing** (see caveats below) rather than trusting it blindly.

## Files

| File | Purpose | Schedule |
|---|---|---|
| `01-health-metrics-daily.json` | Recurring health metrics sync · shorten the cadence in the app if you want fresher same-day data — with point-in-time grain there is no overwrite risk | Date Range: **Since Last Sync** · every 24h |
| `02-health-metrics-weekly-reconciliation.json` | Safety net for missed daily runs (iOS background execution is opportunistic, not guaranteed) | Date Range: **Previous 7 Days** · every 168h (weekly) |
| `03-workouts-recurring.json` | Recurring workout sync | Date Range: **Since Last Sync** · every 3h |
| `04-health-metrics-backfill-onetime.json` | One-time historical seed for metrics | Previous 7 Days, Batch Requests ON |
| `05-workouts-backfill-onetime.json` | One-time historical seed for workouts | Previous 7 Days, Batch Requests ON |
| `06-sleep-catch-up.json` | **Sleep catch-up** — re-sends whole nights (sleep stages + the sleep-only vitals) the same day, so a night cut by "Since Last Sync" is repaired within hours instead of waiting for the weekly run. **Set this up — see below.** | Date Range: **Default** · every 2h · metrics: Sleep Analysis, Respiratory Rate, Apple Sleeping Wrist Temperature, Breathing Disturbances |

## Required app settings (and why)

- **Export Version 2** — the current format; v1 is legacy (no `id` field, different
  field shapes).
- **Summarize Data ON + Time Grouping: Hours** — this is **mandatory, not a
  preference**. With Time Grouping on "Default", Health Auto Export exports raw
  overlapping samples: starting a Fitness-app workout makes HealthKit hold
  overlapping step samples, and one stream delivered the same minutes twice as
  float-noise twins (20/07/2026 showed **15,362** steps against Apple's own
  **5,731**). With **Hours** the app genuinely aggregates and Apple's own
  overlap-dedup is applied at the source. (This also corrects the older
  "Health Auto Export ignores Summarize" note.)
- **Date Range: "Since Last Sync"** for the recurring metrics automation. Since
  migration `041`, `health_metrics` stores **one row per point**, keyed
  `(user_id, metric_name, recorded_at, source)` — the old "one row per
  (metric, day, source), so a re-sync overwrites the day" behaviour is **gone**, so
  a partial window can no longer clobber a day's total and "Yesterday" is no longer
  needed. Keep a separate weekly **"Previous 7 Days"** automation as a
  reconciliation safety net (iOS background execution is opportunistic, not
  guaranteed).
- **"Since Last Sync" cuts nights** — it is fine for everything the iPhone
  receives live, but not for sleep. Add the sleep catch-up automation (`06`,
  next section); keep "Sleep Analysis" ticked in the recurring one too (it is
  the earliest copy of a night, and the app picks the most complete row).
- **Enable all Health Metrics**, not a curated subset (the confirmed real-world
  setting in CLAUDE.md). The `metrics` array in these files is a large subset
  captured when they were built — after importing, tick anything missing in the app
  UI.

Workouts are keyed by id (each workout is its own row), so the workouts automation
stays on a short `Since Last Sync` cadence regardless.

**Confirmed against the real app**: `aggregateData`/`aggregateSleep`
(the "Summarize Data" toggle) only applies to Health Metrics — turning it on
for a Workouts export made the app fail per-day with "Data caching did not
complete successfully" for 6 of 7 days in a real one-time backfill run (only
1 day actually made it through). Both workouts configs (`03`, `05`) now set
these to `false`.

## Sleep catch-up automation (`06`) — why and how

### What goes wrong without it

Sleep showed a night several hours too short for up to six days, until the
weekly "Previous 7 Days" run re-sent it. The cause, measured against a month of
live rows (creation times vs sleep start/end; example times below are
illustrative):

1. The regular automation ("Since Last Sync") re-summarises **Sleep Analysis**
   from a window that starts **about 6 hours before its previous run** — every
   sleep row it sends starts within an hour before that point (or later, if you
   were still awake then). Health Auto Export's documentation doesn't describe
   this; it is what the data shows on every night checked.
2. The Apple Watch passes a night to the iPhone **some minutes after you wake**
   (sleep stages, respiratory rate, wrist temperature and breathing
   disturbances all arrive together; heart rate, HRV and blood oxygen arrive
   live and are not affected).
3. When a run lands in that gap — e.g. you wake at 08:25, the automation runs
   at 08:35 before the Watch has handed over — it exports no sleep. The next
   run (say 10:45) only looks back to 02:35, so a night that began at 00:45
   arrives as **02:30 → 08:25**, and every later run sends shorter fragments
   ending at the same 08:25. The start never arrives again.

This happened on roughly half the nights in a month (15 minutes to 3 hours lost
each time). Respiratory rate for such a night is lost the same way, so the
"Breathing during sleep" cards had gaps too.

### What the catch-up does

A second, sleep-only automation with Date Range **"Default"** — Health Auto
Export's own description: *"Syncs data for the full previous day plus data up
to the current date and time"*. Every run re-sends yesterday and today whole,
so the first run after the Watch hands over delivers the complete night, and
nothing depends on when the previous run happened.

It is safe to re-send the same nights every two hours:

- `health-export-webhook` stores a sleep row under its own **sleepStart**
  (`recorded_at`), upserting on `(user_id, metric_name, recorded_at, source)`.
  The complete night lands as its own row (or overwrites the earlier copy with
  the same start); the app (`healthAggregate.ts`, and the AI/phone copies in
  `ai-proxy`/`phone-gateway`) keeps the most complete row per wake-day and
  drops the fragments — nothing is summed twice.
- Respiratory rate, wrist temperature and breathing disturbances arrive one row
  per clock hour / per night, so a re-send overwrites the same row.
- The payload is tiny (four metrics, two days).

Why not change the regular automation to "Default" instead: it would re-send two
days of *every* metric each run, and its hourly step/energy buckets would switch
from the "since last sync" phase to clock hours — the step/energy duplicate
handling was tuned against the current behaviour, and a phase change there is a
separate, riskier change for no sleep benefit. Keep the weekly reconciliation
(`02`) as the safety net for runs iOS skips.

Until the catch-up has run, the Health page's Sleep window flags a night that
still looks cut ("may be incomplete", `sleepCompleteness.ts`): it starts at
least 2 hours after your early-side bedtime and is shorter than usual.

### Setup (once, on the iPhone)

1. Import `06-sleep-catch-up.json` (steps below), or create it by hand:
   Automations → **+** → REST API.
2. Check, and fix in the app UI if the import got any of it wrong:
   - **Data Type**: Health Metrics.
   - **Health Metrics**: exactly **Sleep Analysis**, **Respiratory Rate**,
     **Apple Sleeping Wrist Temperature**, **Breathing Disturbances** (tick any
     the import missed — the file's names follow the other files' list, but
     "Breathing Disturbances" was not in that list, so check it by eye).
   - **Date Range**: **Default** (the exact picker label).
   - **Summarize Data**: ON · **Time Grouping**: Hours · **Export Version**: 2.
   - **Sync Cadence**: every **2 hours** (iOS decides the real timing; two
     hours means a cut night is normally whole by late morning).
   - **URL** and **Authorization** header: the same as the recurring automation.
3. Test once, a few hours after waking: tap the automation → **Export Now** /
   **Manual Export**. Then open Health → Sleep → **Raw data**: a row should
   start at your real bedtime, and a "may be incomplete" note (if one was shown)
   disappears.

## Import steps (per file)

1. AirDrop / iCloud / email the `.json` file to the iPhone running Health Auto Export.
2. Open it with Health Auto Export → it should offer to import as a new automation.
3. **Verify after import** (the app's import format for these fields isn't
   independently confirmed — these were reverse-engineered from one real
   exported config, see caveats):
   - **Data Type** shows the intended one (Health Metrics vs Workouts) —
     `exportDataType` is a best guess (`"healthMetrics"` / `"workouts"`); if
     it imported wrong, just change it in the UI, the `include*` flags in the
     file are the ones that actually matter for what gets sent.
   - **Export Version** = 2 (should already be set by the file, but confirm)
   - **Time Grouping** shows **"Hours"** — the exact JSON token for that field
     (`exportAggregation`) was inferred from the UI label, so fix it in the app UI if
     it imported wrong. This one is mandatory (see above).
   - **Authorization header** value matches whatever you actually put in the
     Supabase Vault for `HEALTH_EXPORT_WEBHOOK_SECRET` (the file has a
     placeholder value — if you rotated the secret since, update it here)
   - **Sync Cadence** looks right (the file guesses `hours` as the interval
     unit for all values, including the weekly job at `168` hours — if the
     app's UI shows a `days`/`weeks` option instead, feel free to switch to
     that, the effect is the same)

## One-time backfill files (04, 05)

These are meant to run **once**, manually (tap the automation → **Manual
Export** / **Export Now**), not on a recurring schedule. After running once,
either delete the automation or just leave it disabled — don't let it also
fire on its own schedule, since it would keep re-sending the same 7-day
window forever (harmless — the webhook is idempotent — but wasteful).

Want a longer backfill than 7 days? Before running, change
`"exportPeriod"` from `"Previous 7 Days"` to whatever the app's own picker
offers for a custom/longer range (the REST API docs don't guarantee "Previous
7 Days" is the widest built-in option) — or just run the 7-day one repeatedly
via Manual Export while manually adjusting the date range each time, since
the app doesn't currently expose an arbitrary date-range field in this
exported JSON format.

## If import doesn't work

Health Auto Export's *supported* way to create an automation this precisely
is still the in-app UI (Automations → + → REST API) — walk through the same
settings shown in this README's table by hand if importing the file doesn't
work as expected. The JSON files are a shortcut, not the source of truth.
