# Fitbit Air → Lasci's Board — Google Health API integration

> ## ⚖️ CARDINAL RULE (absolute — non-negotiable, supersedes everything below)
> **BOTH sources' data ALWAYS flows into the database in FULL** — Apple (via
> Health Auto Export) **and** Google (Fitbit Air via the Google Health API) —
> **regardless of which source is the default** for any metric. Nothing is ever
> dropped, downsampled, or filtered at INGEST. Every metric is stored tagged by
> `source_family` (`apple` | `google`) so both complete streams coexist.
> **The UI must let us view ANY metric from ANY source (apple / google) at any
> time** via a source switch. "Default" ONLY decides which source is shown first
> (the headline) and which one an "All/summary" view uses so `sum` metrics are
> never double-counted — it NEVER limits what is stored or what can be displayed.
> Storage = always both, complete. Display = any source, on demand.

> Status: **DESIGN / not yet built.** Device (Google Fitbit Air) inbound.
> This doc is the durable memory for the integration (git is the only memory
> across sessions). Update it as decisions are made and as the first live OAuth
> pull confirms/refutes the flagged items in §11.
> Research + adversarial verification completed 2026-07-20 against primary
> Google sources (developers.google.com/health, store.google.com). Non-obvious
> claims carry a confidence tag; anything MEDIUM/LOW must be confirmed on the
> first real pull.

## 0. Decision (locked)
Pull Fitbit Air data **directly from the new Google Health API** — NOT the
deprecated Fitbit Web API, NOT via Apple HealthKit, NOT Health Connect. **Free
tier, no Premium. No historical backfill** (fresh from first wear). Sleep is
**always** sourced from Fitbit (Google). Every other metric follows a
per-metric default: **Apple if it already has the field, else Fitbit** — the
two sources are never mixed/summed for the same metric on the same day.

## 1. Why the Google Health API (and why now)
- Google's own words: *"The Fitbit Web API has been improved and modernized …
  and is now called the Google Health API."* It is the **only** successor.
  (HIGH)
- Legacy Fitbit Web API is **turned down September 2026** (third parties:
  Sept 30, 2026; MEDIUM on the exact day) and stops syncing. Google Health API
  reached **GA / read access end of May 2026**. They run side-by-side until
  turndown, but **OAuth tokens do NOT transfer** — a re-consent is required.
  For a fresh build the sunset is moot: build straight on the new API. (HIGH)
- It is **not** Health Connect (on-device Android) — it is a cloud REST API at
  `https://health.googleapis.com/v4/` over **Google OAuth 2.0**, which is the
  same OAuth family we already use for Google Calendar. That makes the existing
  `calendar-oauth` / `calendar-token` edge-function pattern directly reusable,
  and the webhook-subscription model mirrors our `hevy-sync` /
  `health-export-webhook` receivers. (HIGH)

## 2. Hard sensor reality (metrics follow the hardware)
Fitbit Air ($99, screenless, ~7-day battery, 5 ATM, iOS+Android via the Google
Health app). Sensors: **optical PPG HR (~2s), red+IR (SpO2 + breathing rate),
skin-temperature sensor, 3-axis accelerometer, gyroscope, vibration motor.**

| We GAIN / keep | We LOSE vs a Charge-class device |
|---|---|
| PPG HR (~2s), resting HR, HRV (nightly) | **ECG** — no electrodes (AFib is passive PPG only) |
| SpO2 (red+IR, continuous overnight) | **EDA / stress scans / Stress Mgmt Score** — no EDA sensor |
| Respiratory/breathing rate (nightly) | **Floors** — no altimeter/barometer |
| Skin-temperature variation (overnight, relative) | **Built-in GPS** — Connected-GPS (phone) only |
| Sleep + stage segments, sleeping HR | |
| Steps, distance, calories, Active Zone Minutes | |
| VO2max (best w/ Connected-GPS runs) | |
| AFib / irregular-rhythm notifications (passive) | |

**Two dead-ends worth stating twice:** *stress* is impossible (no EDA sensor
**and** no stress data type in the API), and *Daily Readiness / Sleep Score*
are free **in-app** but are **not API data types** (§11) — recompute our own
from HRV/RHR/sleep if we want them.

## 3. Why the Air is genuinely additive (our watch is a Watch SE 2)
Our Apple unit is a **Watch SE 2** — **no SpO2, no ECG, no wrist-temp** sensor,
and rarely worn asleep. So the Air brings data we have **zero** of today:
**SpO2, skin-temperature variation, and reliable NIGHTLY resting HR + HRV +
respiratory rate + sleeping HR + real sleep-stage segments**, plus **Active
Zone Minutes**. Conversely the SE 2 keeps sole ownership of **floors, running
dynamics, stair speed, cardio recovery, walking-HR-avg, environmental/headphone
audio, time-in-daylight, handwashing**, and **workout GPS** — the Air can't
produce any of those. See the full matrix in §8.

## 4. Architecture (Supabase edge-fn + PWA)
```
Fitbit Air ──BLE ~15min──▶ Google Health app (phone) ──▶ Google Health cloud
                                                              │
                        Google OAuth 2.0 (refresh token in Vault)
                                                              │
        ┌─────────────────────────────────────────────────────────────┐
        │ Supabase edge functions (Deno, self-contained, manual deploy) │
        │  • google-health-oauth   – auth-code exchange + refresh       │
        │  • google-health-sync    – ~3h cron poll + on-demand fetch    │
        │       reads: dailyRollUp/rollUp (summaries), list (intraday), │
        │             reconcile (deduped multi-source stream)           │
        │       writes: health_metrics + health_sleep_segments          │
        │  • (later) google-health-webhook – push subscriber, verify_jwt off │
        └─────────────────────────────────────────────────────────────┘
                                                              │
                                      health_metrics / health_sleep_segments
                                                              │
   PWA (TrainingPage → HealthTab) + AI (briefing, PT Coach, get_health_stats)
   read via a SOURCE-AWARE aggregation layer (healthAggregate.ts)
```
- **Manual deploy** (Dashboard/CLI), each function self-contained (no
  `_shared/` imports) — same constraint as the Hevy functions.
- Freshness ceiling: data is only as new as the last **device→phone BLE sync
  (~15 min)** — a manual "Fetch now" cannot beat that. Best-effort, by design
  (same caveat as the Apple / Health-Auto-Export path).

## 5. Binary source model — the two sources are NEVER mixed
The user wants to **see both** the Apple Watch and the Fitbit Air on the site —
one never silently replaces the other — but a single metric on a single day is
resolved to **exactly one source**, never summed.
- **Sleep → Google/Fitbit, always.** (Air is worn to bed; SE 2 usually isn't.)
- **Everything else → Apple-if-the-field-is-already-populated, else Fitbit.**
  Concretely: metrics currently GREEN (Apple fills them) default to Apple;
  metrics currently RED/empty or net-new default to Fitbit.
- **Per-metric override, persisted.** A per-metric default map lives in
  `useHealthSourcePrefs` (localStorage like `useDayTargets`, or a small
  `health_source_prefs` table if it must be AI-readable). Shipping defaults per
  §8; the user can flip any metric permanently, and a per-section
  `Apple ⇄ Fitbit` switch lets them peek the non-default source.
- **AI reads the default** unless explicitly told otherwise ("Fitbit'e göre
  uykum"). `healthAggregate` gains an optional `sourceFamily` filter on every
  compute fn; `get_health_stats` (ai-proxy) accepts an optional source arg,
  else uses the stored default.
- **Charge-window dedup:** Apple may splice in only the ~1–2h/week the Air is
  off charging; never show both summed. The resolver keys off a stable
  `source_family` (`apple`/`fitbit`/`manual`), not the raw per-device string
  (Apple already varies: "Furkan's Apple Watch" vs "…|Lasci"). A ~1–2h/week
  hole is expected — do NOT alarm on it.

## 6. Auth / OAuth flow (single-user, free, no CASA)
Standard Google **authorization-code** flow (PKCE S256 recommended; our edge fn
is a confidential client so the web-server flow with `client_secret` applies).
```
1. Authorize:
   GET https://accounts.google.com/o/oauth2/v2/auth
       ?client_id=...&redirect_uri=...&response_type=code
       &access_type=offline&prompt=consent
       &code_challenge=...&code_challenge_method=S256
       &scope=<space-separated googlehealth.*.readonly bundles>
2. Exchange (edge fn):
   POST https://oauth2.googleapis.com/token
       grant_type=authorization_code, code, code_verifier, client_id, client_secret, redirect_uri
   → { access_token, expires_in: 3599, refresh_token }
3. Refresh (edge fn, every ~1h or on 401):
   POST https://oauth2.googleapis.com/token
       grant_type=refresh_token, refresh_token, client_id, client_secret
```
**Token-lifetime rule (the single most important operational fact):**
| Consent-screen status | Refresh-token lifetime |
|---|---|
| **Testing** | expires after **7 days** → poller dies weekly ❌ |
| **In Production** | effectively **non-expiring** (unless revoked / unused ~6 mo) ✅ |
So the project **must be published to "In Production."** All `googlehealth`
scopes are **Restricted**, but an **unverified** app is fully usable up to a
hard **100-user cap** — for one user you click through the one-time
"unverified app → Advanced → continue" warning as yourself. **No OAuth
verification and no annual CASA security assessment** are required at that
scale (those only kick in to exceed 100 users / launch publicly; CASA is
$500–$4,500/yr, 2–6 wks). ⚠️ MEDIUM: confirm hands-on that Google surfaces the
click-through for **Restricted** health scopes in Production-unverified (rather
than blocking until verification) — validate in a throwaway Cloud project
before wiring the poller. Worst case = stay in Testing and re-consent weekly.

## 7. Scopes (read-only, minimal set)
All prefixed `https://www.googleapis.com/auth/googlehealth.`:
- `activity_and_fitness.readonly` — steps, distance, active/total calories,
  Active Zone Minutes, VO2 Max, floors (unused for Air), activity level.
- `health_metrics_and_measurements.readonly` — HR, HRV, SpO2, skin-temp
  derivations, resting HR, respiratory rate, weight, body fat.
- `sleep.readonly` — sleep sessions + stage segments.
- (Do **NOT** request `ecg`/`irn` unless §11 confirms the Air surfaces them;
  `nutrition`/`location` not needed — the app owns nutrition, no GPS on Air.)

## 8. Metric mapping + default source (ship these)
Legend for the API column: **INTRADAY** = `list` Sample/Interval available ·
**DAILY** = rollUp/dailyRollUp (or daily-by-nature) · **NO** = not obtainable
(API lacks it OR the Air can't produce it) · **NA** = manual-log only.

### Net-new from the Air (default → Fitbit)
| DB metric_name | Google Health type | API | Note |
|---|---|---|---|
| `oxygen_saturation` (spo2) | Oxygen Saturation + Daily | INTRADAY | red/IR; overnight continuous |
| `skin_temperature` | Daily Sleep Temperature Derivations | DAILY | nightly **variation** (relative, 3-night baseline) |
| `active_zone_minutes` | Active Zone Minutes | INTRADAY | flagship intensity metric (sum) |
| `respiratory_rate` (nightly) | Daily Respiratory Rate + Sleep Summary | DAILY | reliable nightly (SE2 sparse) |
| `heart_rate_variability` (nightly) | HRV + Daily HRV | INTRADAY | nightly RMSSD; SE2 barely worn asleep |
| `resting_heart_rate` | Daily Resting Heart Rate | DAILY | SE2 only 8 rows today |
| `sleeping_heart_rate` | (from HR during sleep session) | DAILY | first-class on Fitbit |

### Improved granularity (Apple keeps default unless flagged)
`heart_rate` (INTRADAY, 14-day cap; Apple in workouts / Fitbit overnight),
`step_count` (INTRADAY), `walking_running_distance` (INTRADAY), `active_energy`
(INTRADAY), `basal_energy_burned` (DAILY, derive = Total − Active),
`vo2_max` (DAILY; keep Apple — Air needs GPS runs), `calories`/Total Calories
(DAILY, rollUp only).

### Sleep (default → Fitbit, always)
`sleep_analysis` → **Sleep (Session: Classic + Stages)**, `sleep.readonly`.
Ingest timestamped stage segments into **`health_sleep_segments`** — a real
hypnogram, no aggregate-overlap ambiguity. Apple `Core` ≈ Fitbit `Light`.

### Stays Apple SE 2 (Air can't produce — keep Apple as source)
`flights_climbed` (no altimeter), all running dynamics
(`running_speed/power/stride_length/vertical_oscillation/ground_contact_time`),
`stair_speed_up/down`, `cardio_recovery`, `walking_heart_rate_average`,
`environmental_audio_exposure`, `headphone_audio_exposure`, `time_in_daylight`,
`handwashing`, `toothbrushing`, `apple_stand_time/hour`, `push_count`, and any
workout GPS/route/pace.

### Not obtainable at all from the Air
`ecg` (no electrodes — API type exists, Air produces nothing),
`stress`/`EDA`/`stress_management_score` (no sensor **and** no API type),
`daily_readiness_score` (free in-app, **not** an API type → recompute),
`sleep_score` (app-computed, not an API field → derive from stages),
`cardio_load` (Fitbit app metric, not an API type), `floors` (no altimeter).

### RED nutrition fields
`dietary_*` / `protein` / `carbohydrates` / `fiber` / `caffeine` /
`total_fat` / `vitamin_d` / `magnesium` / `dietary_water` map to Fitbit
Nutrition/Hydration logs (`nutrition` scope) but are **manual-entry**, and the
app already owns food logging (`food_log_entries`) — **skip**, don't pull.

## 9. DB schema changes
`health_metrics` (point-in-time grain since migration 041; columns
`user_id, metric_name, date, unit, source, value jsonb, recorded_at, …`) needs
**no structural change** — new Fitbit metrics slot in as new `metric_name`s
with the same shape, upserted on `(user_id, metric_name, recorded_at, source)`.

New migration (call it `062_health_source_and_sleep_segments.sql`):
1. **`ADD COLUMN source_family text`** to `health_metrics` and
   `health_workouts` (`'apple' | 'fitbit' | 'manual'`), backfilled from the
   existing `source` string, so the source-resolver keys off a stable family.
2. **`CREATE TABLE health_sleep_segments`** — one row per timestamped stage
   segment: `(id, user_id, start_at timestamptz, end_at timestamptz, stage
   text, source text, source_family text, created_at)`, owner-only RLS +
   audit-exempt (bulk-synced, like the other health tables). Enables a true
   hypnogram; `sleep_analysis` aggregate rows stay for Apple back-compat.
3. New `metric_name`s + their `METRIC_AGGREGATION` class in
   `healthMetrics.ts`: `oxygen_saturation` (latest/minmaxavg),
   `skin_temperature` (latest, delta), `active_zone_minutes` (sum),
   `sleeping_heart_rate` (latest), plus mini-cards/sections per the Health tab
   pattern.
4. (Optional) `health_source_prefs` only if the per-metric default must be
   AI-readable server-side; otherwise localStorage via `useHealthSourcePrefs`.

## 10. Rate limits + poll math
Per user **300 req/min** (unverified ~150/min); per project **120k/min** and
**86.4M/day**; 429 on overrun → backoff. No per-user hourly/daily cap.
- **Poll every ~3h** (8/day). Worst-case ~40 requests/poll (one per type;
  reconcile/rollUp consolidate many). 40 in one burst « 150/min → never trips
  the only binding cap; send sequentially to respect 2.5 QPS unverified.
- Per day: 8×40 + ~20 manual×40 ≈ **1,120 req/day = 0.0013%** of the project
  cap. ~4 orders of magnitude of headroom.
- Query-range caps: **14 days** for HR/active-minutes/total-calories; 90 days
  otherwise (we do no backfill, so windows are tiny anyway).
- **Push subscriptions** exist (`projects.subscribers`) — near-real-time, but
  bounded by the same ~15-min BLE sync and requiring Tink signature
  verification. Start with polling; add webhooks later as an upgrade.

## 11. Open items to confirm on the FIRST live pull (do not trust blind)
- ⚠️ Does Google let a **Restricted**-scope app sit **In Production while
  unverified** with a click-through (→ non-expiring refresh token)? MEDIUM —
  the linchpin of the whole background-sync design. Verify before building.
- ⚠️ Does the Air's passive **AFib** surface as `irregular_rhythm_notification`
  via the API? MEDIUM (and possibly region-gated for Norway). If yes, add the
  `irn` scope.
- ⚠️ `daily_readiness_score` / `sleep_score` confirmed **absent** from the API
  data-type list (recompute) — re-check the live data-types reference in case
  the roadmap adds them.
- ⚠️ Does the Air compute **VO2 Max** without built-in GPS? MEDIUM — keep Apple
  default until observed.
- ⚠️ Confirm **no raw metric or deep-history depth is quietly Premium-gated**
  on the API side (couldn't read Google's Premium comparison page). MEDIUM.
- ⚠️ `store.google.com` specs is a JS SPA that couldn't be parsed; sensor list
  (no ECG/EDA/GPS/altimeter) is cross-checked across reviews — HIGH for those
  four absences, MEDIUM on fine details.

## 12. Prep achievable BEFORE the device arrives
1. This doc (committed).
2. `062` migration written (apply when building).
3. Source-aware `healthAggregate` scaffolding + `useHealthSourcePrefs`
   (testable against existing multi-source Apple rows).
4. Google Cloud project + OAuth client is a **USER** step (§ phases) — document
   exact scopes here (§7) so it's a copy-paste.
---

## 13. Red-team corrections (LOCKED — these SUPERSEDE any conflicting text above)

A 4-lens adversarial review (OAuth/security · API-correctness · architecture ·
product-scope) + author adjudication produced 31 findings (2 critical, 8 high,
11 medium, 10 low; 26 valid / 4 partly / 1 live-check). Verdict: **sound
direction, NOT buildable as-locked** — fix the criticals + highs before writing
the poller. Corrections:

### Critical (design bugs — must fix before any code)
- **C1 · Single-source resolution is MANDATORY, not optional.** Resolve the
  winning `source_family` per `(metric, day)` and filter points BEFORE
  `aggregateGroup`, in ONE place (`fetchHealthMetricSeries`/a resolver) — never
  a default-off filter at 15 call sites. Otherwise every `sum` metric
  double-counts on any day both devices reported. Add a regression test for a
  both-sources day.
- **C2 · Kill the source-model self-contradiction.** Commit to per-day
  single-winner grain and DELETE the "Apple splices in the ~1-2h/week off-charge
  window" sub-day merge. Accept the small hole; never blend two families for one
  metric/day.

### High
- **H1 · `source_family` must never be NULL.** Stamp `'apple'` in
  `health-export-webhook` on every NEW insert AND `COALESCE(source_family,'apple')`
  in the resolver; migration backfills HUAWEI/Apple/Watch source strings → `apple`.
  (Backfill alone leaves post-migration rows NULL → dashboard blanks on strict reads.)
- **H2 · Resolver is per-day + presence-aware.** Use the preferred family IF it
  has data that day, else fall back to the other (never blend). For `latest`
  metrics, filter to the resolved family first, then take latest.
- **H3 · REVERSE the defaults for continuity/cumulative metrics.** Once the Air
  is live (24/7 wear), default steps / distance / active_energy / active_zone_minutes /
  all-day heart_rate → **Fitbit**. Apple-default silently UNDERCOUNTS daily totals
  (SE2 is daytime-only). Keep Apple only where SE2 owns the sensor: running
  dynamics, mobility (walking/stair speed), audio exposure, cardio_recovery,
  and VO2max (until the Air's Connected-GPS estimate is observed). Weight/BMI/
  body-fat stay on the Huawei scale. Sleep stays Fitbit. → The per-metric default
  map is a CURATED table = the single source of truth for both the resolver and
  the AI layer; "Apple if populated" is demoted to a fallback only.
- **H4 · Sleep storage resolved.** Write Fitbit sleep as `health_sleep_segments`
  rows; add a segments→per-night-summary fn feeding SleepSection;
  `computeSleepSummary` filters to `source_family='fitbit'` when a Fitbit night
  exists, falling back to Apple `sleep_analysis` only when none. Never let both
  contribute to one night.
- **H5 · Do NOT reuse "Sleep Score" / "Readiness Score" names** for home-grown
  recomputes — that violates the prior explicit "no derived sleep metrics"
  decision. They are in-app-only, NOT API types. Show an honest "not in API"
  note; any derived recovery metric must be distinctly named + user-approved.
- **H6 · OAuth token lifetime = ASSUMPTION pending a hands-on test.** Before the
  poller: in a throwaway Cloud project, publish Production-unverified, self-consent
  with the REAL restricted `googlehealth.*` scopes, capture the refresh token,
  and confirm it survives >7 days AND a fresh access-token refresh. Author's
  defense: Google's OAuth docs DO support "Production = durable / Testing = 7-day",
  so the residual risk is narrowly whether the restricted-scope consent
  *click-through* is allowed unverified — not the token model itself. If the test
  fails, pivot to an **Internal** Workspace app (if power.no qualifies; no cap /
  no 7-day / no verification) or accept a "reconnect" UX. Ship a monitored
  refresh-failure path (app_error_logs + a HealthTab reconnect banner) regardless.
- **H7 · Reframe the Calendar analogy.** Token plumbing is reusable, but
  `googlehealth.*` are **RESTRICTED** (stricter than Calendar's SENSITIVE): the
  ≤100-user unverified click-through is unproven for restricted scopes and, if
  blocked, forces OAuth verification + annual CASA. State this as risk, not fact.

### Medium (fix in the doc / design before build)
- Refresh token lives in a **token table** (extend `user_calendar_tokens` with a
  provider column, or a sibling table) — NOT Vault; mint access tokens per call.
  Only `CLIENT_ID`/`CLIENT_SECRET` go in Vault.
- OAuth callback: add a **`state`** (CSRF) param bound to the session; keep
  `verify_jwt` ON for the callback (it's not a public webhook); confidential
  client → PKCE optional (drop it, or persist `code_verifier` server-side keyed
  by `state`). This is a NEW redirect flow, not the calendar popup.
- **Timezone/date:** convert UTC dataPoints → Europe/Oslo (DST-aware) before
  slicing the `date` column; keep `recorded_at` as the true UTC instant (mirrors
  migration 041). Derive DAILY-rollup `recorded_at` from the value's OWN civil
  day, not poll time — else every 3h poll inserts duplicate daily rows.
- **Read-method table fix:** `list` for all daily-* + Session types (HRV, RHR,
  respiratory, SpO2, skin-temp, VO2max, sleep, IRN, ECG). `rollUp`/`dailyRollUp`
  ONLY for interval activity (steps, distance, active-energy, AZM, heart-rate,
  total-calories). HRV is DAILY, not intraday.
- **Reliability surface:** persist `last_successful_sync` + `last_error`; a
  HealthTab "stale" banner; a daily reconciliation pull inside the 14-day window
  (an outage >14 days is otherwise permanently unrecoverable — no backfill).
- Consider **Internal** user type if power.no is a Workspace org (removes
  verification/cap/7-day; weigh employer-identity tradeoff — document decision).
- A static **privacy-policy URL + homepage** is often required to save restricted
  scopes on the consent screen.
- Confirm **source-toggle granularity** with the user (global vs per-section vs
  per-metric); the default is a stable one-time curated choice, NOT a live
  "is it populated now" test (which would flip a metric's source retroactively).

### Confirmed strengths (survived scrutiny)
API choice (Google Health API = Fitbit-Web-API successor), scope inventory,
data-type/metric availability, DB point-grain, "no premium", "no backfill", and
the huge rate-limit headroom (3h poll trivial) are all correct. Endpoints
(`dataPoints.list/reconcile/rollUp/dailyRollUp`, `pairedDevices`,
`projects.subscribers`) verified real.

### Prep that is SAFE to start now (before the device / before OAuth test)
Commit this doc; draft migration `062` (with the H1 `source_family` stamping +
backfill); build the source-aware aggregation scaffolding (C1/H2 resolver +
curated default map, testable against existing Apple rows); add the new
`metric_name`s. Do NOT write the poller until the OAuth token test (H6) passes
and §4/§5/§8 resolver semantics are rewritten per C1/C2/H2/H3.
