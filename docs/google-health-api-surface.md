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


---

# LIVE-VERIFIED round 2 (2026-07-21, real token sweep — every line below observed, not inferred)

## 🔑 Path IDs are KEBAB-CASE (verified against every data type)
`users/me/dataTypes/{id}/dataPoints` — {id} = kebab-case of the union field:
`steps, distance, sleep, exercise, weight, height, altitude, floors,
active-energy-burned, basal-energy-burned, active-zone-minutes, heart-rate,
heart-rate-variability, daily-heart-rate-variability, daily-resting-heart-rate,
daily-heart-rate-zones, time-in-heart-rate-zone, oxygen-saturation,
daily-oxygen-saturation, daily-respiratory-rate, respiratory-rate-sleep-summary,
daily-sleep-temperature-derivations, core-body-temperature, activity-level,
active-minutes, sedentary-period, vo2-max, daily-vo2-max, run-vo2-max, body-fat,
blood-glucose, swim-lengths-data` — ALL return 200 on list.
Exceptions: `floors` → list unsupported (allowed: reconcile, rollup, dailyRollup);
`electrocardiogram`/`irregular-rhythm-notification`/`food` → 403 outside our 3 scopes.
`pairedDevices` needs the extra scope `googlehealth.settings.readonly` (403 otherwise
with that scope named in WWW-Authenticate) — optional, data flow doesn't need it.
(snake_case and camelCase multi-word ids both 400 — kebab only. Filter tokens are
snake_case, path ids kebab-case, JSON fields camelCase. Three casings, one API.)

## ⚠️ CRITICAL: the API mirrors HealthKit too — poller MUST filter by platform
`dataPoint.dataSource.platform` observed values: `"FITBIT"` and `"HEALTH_KIT"`.
The Google Health iOS app mirrors Apple HealthKit into this API — live sweep found
sleep/HRV/exercise points from `com.apple.health.*` and weight/body-fat from
`com.aspiegel.health` (Huawei Health) with `platform: "HEALTH_KIT"`, alongside
native `platform: "FITBIT"` steps/HR/energy from the Air. **The Phase 3 poller must
keep ONLY `platform == "FITBIT"` points** — HealthKit-mirrored rows are the SAME
data our Apple webhook already ingests; storing them as source_family='fitbit'
would triple-store and double-display it. (Client-side filter on the response —
the list filter grammar has no dataSource field.)

## Verified payload shapes (first live points)
- **steps / active-energy-burned / activity-level (FITBIT)**: minute-grain
  intervals — `interval.{startTime,endTime,startUtcOffset,civilStartTime,civilEndTime}`,
  value `count` (string!) / `kcal` (number). Numeric strings appear throughout
  (`"count": "61"`, `"beatsPerMinute": "70"`) — parse with Number().
- **heart-rate (FITBIT)**: SINGLE SAMPLES — `sampleTime.{physicalTime,civilTime,utcOffset}`
  + `beatsPerMinute` (~seconds apart). NOT Min/Avg/Max like the Apple webhook shape —
  Phase 3 must map samples → our minmaxavg aggregation handles raw samples per hour
  (or pre-bucket to Min/Avg/Max per point at ingest to match the Apple value shape).
- **sleep**: `type: "STAGES"` + `stages[]` (each `{startTime,endTime,type:LIGHT|DEEP|REM|WAKE(?)}`)
  + `summary.{minutesAsleep,minutesAwake,minutesInSleepPeriod,minutesToFallAsleep,
  stagesSummary[{type,minutes,count}]}` + `metadata.externalId` (→ `source_record_id`!)
  — exactly the health_sleep_segments shape. Stage names LIGHT/DEEP/REM (+ awake) —
  Fitbit vocabulary confirmed (Apple Core ≠ these; never merge vocabularies).
- **heart-rate-variability**: samples with BOTH `rootMeanSquareOfSuccessiveDifferencesMilliseconds`
  (rmssd — 0 on the HealthKit-mirrored point) and `standardDeviationMilliseconds` (sdnn).
  Apple measures SDNN, Fitbit natively RMSSD — record which field per platform in Phase 3.
- **daily-* summaries** (`daily-resting-heart-rate`, `daily-respiratory-rate`, …):
  keyed by civil `date {year,month,day}`, single value. `daily-heart-rate-zones`
  returned a config-like row dated 9998-12-31 (zone thresholds, not a day record) — skip sentinel dates.
- **weight**: `weightGrams` (integer grams); **body-fat**: `percentage`.
- **exercise**: session interval + `exerciseType` ("WALKING"), `metricsSummary`
  (kcal, distanceMillimeters, steps, pace, avg HR), `exerciseEvents` (PAUSE/RESUME),
  `activeDuration` seconds-string.
- Every point carries `utcOffset` (7200s = Oslo CEST) AND civil times — the
  UTC→Europe/Oslo conversion the design doc §13 required is provided by the API
  itself; use civil times for our `date` column (same rule as the Apple webhook).

## Consequences for Phase 3 (poller spec deltas — all locked by observation)
1. Fetch per type with kebab-case ids; filter grammar per type class (interval /
   sample / daily / session / sleep-end-time).
2. Drop every point whose `dataSource.platform != "FITBIT"`.
3. Numeric strings → Number() at ingest; weightGrams→kg (/1000); civil time → `date`.
4. Sleep → `health_sleep_segments` rows from `stages[]` (+ `metadata.externalId`
   as `source_record_id`); session summary can also become a `sleep_analysis`-shaped
   `health_metrics` row (Fitbit family) so existing charts work before Phase 4 UI.
5. HR arrives as samples → aggregate to hourly Min/Avg/Max at ingest OR store raw
   qty samples; DECIDE in Phase 3 spec (leaning: store per-sample rows, they are
   exactly our point-grain model; volume ~1/5s while worn — watch rate limits, may
   need the rollUp endpoint for HR instead).
6. `oxygen-saturation`/`daily-oxygen-saturation` both 200 but EMPTY pre-first-night —
   re-pull after a full night to settle the minmaxavg-vs-latest question (§11).
