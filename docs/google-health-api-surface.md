# Google Health API v4 — VERIFIED surface (from the live discovery document)

> Fetched live 2026-07-21 from `https://health.googleapis.com/$discovery/rest?version=v4`
> (no auth required). This supersedes any guessed endpoint paths in earlier notes —
> everything below is the API's own machine-readable self-description, not research
> summary. The Phase 3 poller (`google-health-sync`) must be written against THIS.

## Base + auth
- Base: `https://health.googleapis.com/`
- All user-data paths live under `v4/users/{usersId}/…` — use **`users/me`**.
  (The earlier `v4/pairedDevices` guess 404s; the `users/me` prefix was missing.)
- OAuth scopes confirmed in the discovery doc match the design doc §7 exactly
  (`googlehealth.activity_and_fitness.readonly`,
  `googlehealth.health_metrics_and_measurements.readonly`,
  `googlehealth.sleep.readonly`; write-only + ecg/irn/location/nutrition/profile/
  settings variants exist but are not requested).

## Endpoints (read side)
| Method | Path | Notes |
|---|---|---|
| GET | `v4/users/me/pairedDevices` | list devices (pageSize ≤100, default 5) |
| GET | `v4/users/me/pairedDevices/{id}` | one device |
| GET | `v4/users/me/dataTypes/{dataType}/dataPoints` | **the intraday list** — default page 1440 points, max 10000, `filter` (AIP-160) + `pageToken` |
| GET | `v4/users/me/dataTypes/{dataType}/dataPoints/{id}` | single point |
| GET | `v4/users/me/dataTypes/{dataType}/dataPoints:reconcile` | changed-since reconciliation |
| POST | `v4/users/me/dataTypes/{dataType}/dataPoints:rollUp` | interval roll-up |
| POST | `v4/users/me/dataTypes/{dataType}/dataPoints:dailyRollUp` | daily roll-up |
| GET | `v4/users/me/profile` / `settings` / `identity` / `irnProfile` | user meta |
| POST/GET/PATCH/DELETE | `v4/projects/{project}/subscribers[/…/subscriptions]` | webhook-push plumbing (deferred per design doc §10) |

## Data types (the DataPoint union — 40 fields, VERIFIED complete list)
`steps, distance, activeEnergyBurned, basalEnergyBurned, activeZoneMinutes,
heartRate, heartRateVariability, dailyHeartRateVariability, dailyRestingHeartRate,
dailyHeartRateZones, timeInHeartRateZone, oxygenSaturation, dailyOxygenSaturation,
dailyRespiratoryRate, respiratoryRateSleepSummary, dailySleepTemperatureDerivations,
coreBodyTemperature, sleep, exercise, activityLevel, activeMinutes, sedentaryPeriod,
vo2Max, dailyVo2Max, runVo2Max, weight, height, bodyFat, bloodGlucose, floors,
altitude, swimLengthsData, electrocardiogram, irregularRhythmNotification, food,
nutritionLog, hydrationLog, foodMeasurementUnit, dataSource, name`

Key implications for our pipeline:
- **Intraday granularity confirmed available** for every cumulative metric the
  hourly bucket-merge needs (`steps`, `distance`, `activeEnergyBurned`,
  `basalEnergyBurned`, `activeZoneMinutes`, `heartRate`) — satisfies the Phase 3
  entry gate "poller must fetch intraday, not dailyRollUp, for cumulative metrics".
- **SpO2 has BOTH shapes**: `oxygenSaturation` (samples) and
  `dailyOxygenSaturation` (daily summary). Which one the Air actually populates —
  and therefore whether our `minmaxavg` lock for `oxygen_saturation` is right —
  is answered by pulling both once a night of data exists (§11 item).
- **Skin temp** arrives as `dailySleepTemperatureDerivations` (+ `coreBodyTemperature`
  exists as a type; Air likely populates only the former). VO2max: `dailyVo2Max` /
  `runVo2Max`.
- `dataPoint.dataSource` exists — provenance survives into our `source` column.

## Filter grammar (AIP-160; ordered by interval start time DESC)
- Interval types: `{type}.interval.start_time >= "RFC3339" AND {type}.interval.start_time < "RFC3339"`
  or civil: `{type}.interval.civil_start_time >= "YYYY-MM-DD[THH:mm:ss]"`
- Sample types (e.g. weight): `{type}.sample_time.physical_time` / `.civil_time`
- Daily summaries: `{type}.date < "YYYY-MM-DD"` (e.g. `daily_heart_rate_variability.date`)
- Sessions (exercise): `exercise.interval.civil_start_time >= …` (sleep/ECG excluded)
- **Sleep is special**: filter by END time — `sleep.interval.end_time >= … AND < …`
  or `sleep.interval.civil_end_time` (also supports `OR`). End-time filtering ==
  "the night you woke up", matching our `sleepNightKey` night-attribution rule.
- ECG: start_time `>=` only.

Filter field names are snake_case data-type tokens (`steps`, `distance`,
`daily_heart_rate_variability`, `sleep`) — the JSON union fields are camelCase.

## Smoke-test curls (Bearer = OAuth Playground access token)
```bash
# devices
curl -H "Authorization: Bearer $T" "https://health.googleapis.com/v4/users/me/pairedDevices"
# today's steps (intraday) — filter URL-encoded
curl -H "Authorization: Bearer $T" "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints?filter=steps.interval.civil_start_time%20%3E%3D%20%222026-07-21%22"
# heart rate today
curl -H "Authorization: Bearer $T" "https://health.googleapis.com/v4/users/me/dataTypes/heartRate/dataPoints?filter=heart_rate.interval.start_time%20%3E%3D%20%222026-07-21T00%3A00%3A00Z%22"
# last night's sleep (run the morning after wearing it overnight)
curl -H "Authorization: Bearer $T" "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints?filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-07-21%22"
```
(If `heartRate`'s filter token differs, try `heart_rate` vs `heartRate` in the
filter string — the path segment is the camelCase union field name; note which
works and record it here.)
