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
| `01-health-metrics-daily.json` | Recurring daily health metrics sync | Date Range: **Yesterday** · every 24h |
| `02-health-metrics-weekly-reconciliation.json` | Safety net for missed daily runs (iOS background execution is opportunistic, not guaranteed) | Date Range: **Previous 7 Days** · every 168h (weekly) |
| `03-workouts-recurring.json` | Recurring workout sync | Date Range: **Since Last Sync** · every 3h |
| `04-health-metrics-backfill-onetime.json` | One-time historical seed for metrics | Previous 7 Days, Batch Requests ON |
| `05-workouts-backfill-onetime.json` | One-time historical seed for workouts | Previous 7 Days, Batch Requests ON |

## Why "Yesterday" for the daily metrics job, not "Today" or "Since Last Sync"

Health metrics are stored **one row per (metric, day, source)** — a re-sync
for the same day *overwrites* the previous row, it doesn't add to it. If a
recurring job runs multiple times a day with a range that only covers a
partial window (`Today` mid-day, or `Since Last Sync` at a few-hour cadence),
each run overwrites the previous one with a smaller partial number —
`Step Count` for today can end up showing a tiny fraction of the real total.

`Yesterday` always exports one full, closed calendar day — no partial-day
overwrite risk. Trade-off: today's data isn't visible until tomorrow's run.
Fine for a retrospective personal dashboard, not for same-day/real-time
tracking.

Workouts don't have this problem (each workout is its own row keyed by id),
so the workouts automation can safely stay on a shorter `Since Last Sync`
cadence.

**Confirmed against the real app**: `aggregateData`/`aggregateSleep`
(the "Summarize Data" toggle) only applies to Health Metrics — turning it on
for a Workouts export made the app fail per-day with "Data caching did not
complete successfully" for 6 of 7 days in a real one-time backfill run (only
1 day actually made it through). Both workouts configs (`03`, `05`) now set
these to `false`.

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
