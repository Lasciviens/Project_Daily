# Fitbit Air → Lasci's Board — Google Health integration (as built)

> **Status: SHIPPED 21/07/2026** (foundation → poller → UI/AI wiring). Migrations `062` (`source_family` +
> `health_sleep_segments`) and `063` (`google_health_sync_state`) applied; poller = the `google-health-sync` edge
> function. **v1.1 metrics** (distance, Active Zone Minutes, HRV, skin temperature, SpO2) shipped 22/07/2026; sleep
> night-attribution + the `get_health_stats` sleep fix 23/07/2026. API contract → `google-health-api-surface.md`;
> current feature state → `CLAUDE.md`.
> **This doc is as-built + durable facts + open items; design-time speculation has been removed.**

## 1. CARDINAL RULE (absolute)

**Both sources are always stored in FULL** — Apple (via Health Auto Export) and Fitbit Air (via the Google Health
API). Nothing is dropped, downsampled or filtered at INGEST. Every row is tagged `source_family`, whose values are
**`apple` | `fitbit` | `manual`** (migration 062: `CHECK (source_family IN ('apple','fitbit','manual'))` — the
pre-implementation `apple | google` naming was never shipped).

**Display = any source on demand:** a per-section **Auto / Apple / Google** switch on Steps / Energy / Heart / Sleep
(`SourceToggle.tsx`), where *Auto* = the resolver union and Apple/Google are pure single-family fetch filters.
"Default" only decides what is shown FIRST; it never limits what is stored or displayable. **Never sum two families
for the same metric-hour.**

## 2. As-built architecture

```
Fitbit Air ──BLE ~15min──▶ Google Health app (phone) ──▶ Google Health cloud (v4 REST)
        google-health-sync (Deno edge fn, self-contained, manual deploy, verify_jwt = false)
          dual auth: user JWT ("⟳ Fitbit" in Settings ⚙ → Google) OR x-sync-secret cron
          writes: health_metrics (hourly) + health_sleep_segments + google_health_sync_state
   PWA (TrainingPage → HealthTab) + AI (briefing, PT Coach, get_health_stats)
   read through the source-aware aggregation layer (healthAggregate.ts)
```

- **ONE unified "Connect Google" consent** on the **existing** `calendar-oauth`/`calendar-token` pair and the
  **existing** `user_calendar_tokens` row — Calendar + Tasks + the three `googlehealth.*.readonly` scopes on one
  refresh token; scope list lives in `SettingsMenu.tsx`. The design-time `google-health-oauth` /
  `google-health-token` / `google-health-webhook` functions and the `user_health_tokens` table **were never built —
  do not look for them.**
- Health access tokens are minted by **down-scoping at refresh time** (only the 3 health scopes on the refresh
  request), because the API rejects mixed-scope tokens (§7). `calendar-token` is deliberately left wide.
- `google_health_sync_state` carries `last_success_at`/`last_error`/`last_error_at` for the stale and reconnect cues;
  `invalid_grant` → `reconnect_required`. Ingest grain is **hourly**. `health_sleep_segments` rows carry
  `source_record_id` (← `metadata.externalId`) plus a natural unique key, so re-delivery is idempotent; no audit
  trigger (standing bulk-sync exemption).
- `source_family` is `NOT NULL DEFAULT 'apple'` **and** explicitly stamped by `health-export-webhook`
  (belt-and-suspenders, not either/or). A `NOT NULL DEFAULT <constant>` add is metadata-only in modern Postgres, so
  it was safe at ~60k rows.
- Freshness ceiling = the device→phone BLE sync (~15 min). A manual fetch cannot beat it.

## 3. Resolver rules as shipped

**This section SUPERSEDES the old design-time C1/C2/H2/H3 resolution text.**

- Resolution is **stream-level and hourly** (`resolveSourcePoints` in `healthAggregate.ts`, policy in
  `healthSourceDefaults.ts`), not one winning family per `(metric, day)`. The design's instruction to delete sub-day
  merging **was reversed by user-approved redesign**: the real requirement is gap-filling *and* no same-hour
  double-count. Strategies: `bucket` (hour), `day`, `night` (sleep).
- **Ladders.** Cumulative metrics (`step_count`, `walking_running_distance`, `active_energy`, `basal_energy_burned`,
  `active_zone_minutes`, plus the Apple-exclusive flows `apple_exercise_time`/`apple_stand_time`/`time_in_daylight`)
  use `manual > watch > fitbit > phone` — **"wrist beats pocket"**, the user's own call, superseding the red team's
  inferred Apple-vs-Fitbit default. **Physiological** metrics (`sleep_analysis`, `heart_rate`, `resting_heart_rate`,
  `heart_rate_variability`, `respiratory_rate`, `oxygen_saturation`, `skin_temperature`, `sleeping_heart_rate`) are
  Fitbit-first — `manual > fitbit > watch > phone`, where `phone` is a theoretical last rung because a phone cannot
  sense any of them — still resolved hourly so two devices' min/max are never blended. Everything else stays
  Apple-first. **`'manual'` is rung 1 of every ladder.**
- The resolver emits a **flattened, unioned POINT SET**, never a pre-summed number: resolve the winning stream per
  window → flatten the winning points into one array → hand it to the unchanged `aggregateGroup`/`rangeFromPoints`.
  "Day total = sum of hourly winners" is only valid for `sum` metrics and is nonsense for `minmaxavg`/`average`; the
  point-set design works for every aggType with zero special-casing.
- **`flights_climbed` must never enter the Fitbit default set** — the Air has no altimeter/barometer. (Worth keeping:
  the **iPhone does** have a barometer, so "a phone can't sense this" does not apply to `flights_climbed` the way it
  does to the physiological metrics.)
- The `bucket` key is `recorded_at.slice(0,13)` (**UTC** hour) while `computeHourlyBuckets` displays **local** hours
  — **not a bug**: Oslo's UTC offset is a whole number of hours, DST included, so these are the same real-time
  boundaries with different labels.
- `collapseIntraStreamMinuteDuplicates` is **`sum`-metrics only** and runs **after** inter-stream resolution —
  deliberately not applied to `heart_rate`/minmaxavg (a same-minute float twin moves an average by a hair; it
  inflates a sum ~2.7×).
- A per-metric preference table (`health_source_prefs` / `useHealthSourcePrefs`) was designed, **rejected by the
  user, dropped from migration 062, and never built** — the requirement was gap-filling, not a manual toggle. Do not
  reintroduce it without a new decision.

## 4. Measured evidence (irreplaceable — keep the numbers)

- **Live DB scan 21/07/2026**, 14 days, ~54k rows: `step_count` had **159 of 191 hours with 2+ streams**;
  `walking_running_distance` 4 hours; `active_energy` 21 hours (identical duplicate delivery under **two
  Watch-labelled source strings**). Every other metric was single-stream at that time.
- **Double-count proof 10/07/2026:** Watch stream **5,721** + Phone stream **4,634** in the *same* hours (hour 07:
  both exactly **103** — the same physical steps twice) → the app displayed **10,355** for a ~5,700-step day.
  Resolver replay: **10,355 → 5,721**. Apple's own dedup independently produced **5,721** for that day — two
  methods, one answer. 20/07/2026 = **5,732** (user expected 5,731).
- **Intra-stream twins 20/07/2026:** **15,362** displayed vs Apple's **5,731** (88 of 94 minutes were float-noise
  twins inside ONE stream).
- **User-approved wipe of all July `health_metrics` (67,626 rows across three passes)** + hourly re-export
  01–21 Jul → the DB has been uniform hourly since 21/07/2026. **`source=eq.manual` was checked BEFORE the wipe and
  returned empty** — nothing unrecoverable was lost. The reusable lesson: **manual entries never existed in
  HealthKit and can NEVER be recovered by re-export — always check for `source='manual'` rows before any destructive
  health-data operation.**
- **First real Fitbit pull 21/07/2026 12:03 UTC:** steps 672 on day one, hourly HR Min/Avg/Max, active energy. Union
  arithmetic hand-checked: apple 2,959 + fitbit 672 with 1 overlapping hour → **3,099**
  (`2,959 + 672 − 3,099 = 532` = the losing stream's dropped hour; `672 − 532 = 140` = Fitbit's genuine gap-fill) —
  the CARDINAL RULE's union-not-sum behaviour on real dual-source data.
- **"Zero drift" redefined honestly:** output identical to before **except** where the old output was a proven bug —
  byte-identity would have meant shipping a resolver known to produce a 10,355-step day.

## 5. Sensor reality (hardware decides which metrics exist)

Fitbit Air: screenless, ~7-day battery, 5 ATM. Sensors = optical PPG, red+IR, skin-temperature, 3-axis
accelerometer, gyroscope.

| Air gains / owns | Air can NEVER produce |
|---|---|
| PPG HR (~2 s), resting HR, nightly HRV | **ECG** — no electrodes |
| SpO2 (red+IR, continuous overnight) | **EDA / stress / Stress Management Score** — no sensor **and** no API type |
| Respiratory rate + skin-temperature variation (nightly) | **Floors** — no altimeter/barometer |
| Sleep stages + sleeping HR | **Built-in GPS** — Connected-GPS (phone) only |
| Steps, distance, calories, AZM, VO2max (Connected-GPS) | |

**Watch SE 2 keeps sole ownership of:** running dynamics, stair speed, cardio recovery, walking-HR-average, audio
exposure, time in daylight, handwashing/toothbrushing, stand time, workout GPS/route/pace. (The SE 2 has no SpO2,
ECG or wrist temp — which is what makes the Air additive.) **Daily Readiness / Sleep Score are in-app only, NOT API
data types** — and per the standing "no derived sleep metrics" decision, do not recompute-and-reuse those names;
show an honest "not in the API" note instead.

## 6. Metric → Google Health dataType map

| DB `metric_name` | Google Health type | Read | Shipped |
|---|---|---|---|
| `step_count` | `steps` | intraday list | v1 |
| `active_energy` / `basal_energy_burned` | `activeEnergyBurned` / `basalEnergyBurned` | intraday list | v1 |
| `heart_rate` | `heartRate` (samples) | list → per-hour Min/Avg/Max at ingest | v1 |
| `sleep_analysis` + segments | `sleep` (Session: Stages) | list, filter by END time | v1 |
| `resting_heart_rate` | `dailyRestingHeartRate` | daily | v1 |
| `walking_running_distance` | `distance` | intraday list | v1.1 (22/07) |
| `active_zone_minutes` | `activeZoneMinutes` | intraday list | v1.1 |
| `heart_rate_variability` | `dailyHeartRateVariability` | daily | v1.1 |
| `skin_temperature` | `dailySleepTemperatureDerivations` | daily (relative variation) | v1.1 |
| `oxygen_saturation` | `oxygenSaturation` **or** `dailyOxygenSaturation` | dual-path A/B (§10) | v1.1 |

Sleep stages land in `health_sleep_segments` (a real hypnogram) plus one `sleep_analysis`-shaped aggregate
`health_metrics` row so existing charts work; Fitbit `LIGHT` → our `core`. **Apple `Core` ≈ Fitbit `Light`; never
merge the two stage vocabularies.** **RED nutrition fields** (`dietary_*`, protein, carbs, fibre, caffeine, …) are
manual-entry on Fitbit and the app already owns food logging — **skip, don't pull.**

## 7. OAuth / Google durable facts

- Restricted `googlehealth.*` scopes on an **External + Production + unverified** app **do** surface the "Google
  hasn't verified this app → Advanced → continue" click-through (verified hands-on 21/07/2026 — the plan's #1
  unknown).
- **Consent-screen Testing = 7-day refresh token; Production = effectively non-expiring**, which is why publishing
  to Production is mandatory. Escape hatch if the posture ever fails: an **Internal** Workspace app (no user cap, no
  verification, no 7-day) at the cost of an employer-tied identity.
- **The API rejects mixed-scope access tokens** — `403 DISALLOWED_OAUTH_SCOPES` naming `cl_events`,`tasks`. The fix
  is down-scoping at refresh (§2).
- **A re-consent can omit a fresh `refresh_token`** unless `prompt=consent` is forced — so a scope-union re-consent
  can leave the UI reading "connected" while the stored token still covers only the old scopes. Verify with Google's
  `tokeninfo` endpoint after any scope change.
- Google's **OAuth Playground defaults to its own shared client**, which cannot request Restricted `googlehealth.*`
  scopes — flip "Use your own OAuth credentials" or it looks like a mysterious failure.

## 8. Rate limits + cadence

300 req/min per user (~150/min unverified); project caps are orders of magnitude beyond reach; **~6 requests per
poller run**. Query-range cap is **14 days** for HR / active-minutes / total-calories (90 days otherwise) → **an
outage longer than 14 days is permanently unrecoverable, by design: there is no backfill.** Recommended cron is
hourly (`0 * * * *`); sub-15-min polling gains nothing because Air→phone→cloud latency dominates. Push subscriptions
(`projects.subscribers`) exist and are deliberately deferred.

## 9. HEALTH_KIT mirroring + the platform allowlist

The Google Health iOS app itself holds Apple HealthKit READ permission (granted during Air setup) and republishes it
into this same cloud API, so `dataPoint.dataSource.platform` can be `HEALTH_KIT`. The poller therefore uses a strict
**allowlist**: `platform === 'FITBIT'` passes, everything else (HEALTH_KIT, missing, unknown future values) is
dropped and counted in `skipped_non_fitbit`.

Rationale worth keeping: default-deny matches this repo's convention (ai-proxy's table allow-list); the mirror's
**contents can drift** as Apple-side sources change; and a missed platform filter produces wrong numbers **that look
like real Fitbit data** — worse than a `rollUp`-vs-`list` mistake, which merely produces wrong numbers. Also locked:
the poller must use the intraday `dataPoints` **list** endpoint, **never** `:rollUp`/`:dailyRollUp`, for cumulative
metrics — a pre-aggregated daily number cannot feed the hourly bucket-merge the resolver depends on.

## 10. Open items (the ONE place these live)

- **≥7-day refresh-token survival test** — token captured 21/07/2026, due from 28/07/2026. A non-blocking formality
  now: the genuinely uncertain part (the restricted-scope click-through) already passed.
- **Hardening:** a daily reconciliation pull inside the 14-day cap, a stale-data banner, and a decision on the
  webhook-push upgrade.
- **Body-section source toggle** (different header layout) · **Source Lab / compare view** · **hypnogram
  verification** against a real Fitbit-app night.
- **SpO2 shape unconfirmed** — the poller ships a dual-path A/B (`oxygen-saturation` samples → hourly Min/Avg/Max,
  else the `daily-oxygen-saturation` summary) with an `oxygen_saturation_source` counter in the response. Confirm
  which path the Air populates and correct `METRIC_AGGREGATION`'s locked `minmaxavg` guess if needed.
- **HRV field per platform** — Apple measures SDNN, Fitbit natively RMSSD. **AFib / irregular-rhythm availability on
  the Air** — would need the `irn` scope; possibly region-gated. **VO2max without built-in GPS** — keep Apple as the
  source until observed. **Any Premium gating on the API side.**
- **Whether Calendar's own create/view/sync still works after the unified re-consent was never explicitly
  confirmed** — click it once.
