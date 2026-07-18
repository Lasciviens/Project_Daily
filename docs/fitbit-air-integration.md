# Fitbit Air → Lasci's Board — integration design

> Status: **PLAN / not yet built.** Device (Google Fitbit Air) on the way.
> This doc is the durable memory for the integration (git is the only memory
> across sessions). Update it as decisions are made.

## 0. Why this exists
The user bought a **Google Fitbit Air** (announced 2026-05-07, screenless
$99 WHOOP-style tracker; sensors: PPG heart-rate, red/IR SpO2, skin-temp,
accelerometer, gyroscope). It will be worn 24/7 except ~1–2h/week for
charging (7-day battery, 5-min→1-day fast charge). It becomes the **primary**
source for sleep and most passive health metrics; the Apple Watch + Huawei
Health → Apple HealthKit → Health Auto Export pipeline stays as a **gap-filler**.

## 1. Hard sensor reality (metrics follow the hardware)
Air is a stripped-down tracker. Confirmed from Google Store / DC Rainmaker /
9to5Google (2026-05):

| We GAIN / keep | We LOSE vs a Charge-class device |
|---|---|
| PPG heart-rate (~2s sampling), resting HR | **ECG** — no electrodes (AFib is passive PPG only) |
| SpO2 (red+IR, continuous overnight) | **EDA / stress scans / Stress Management Score** — no EDA sensor |
| HRV (sleep), respiratory rate (sleep) | **Floors climbed** — no altimeter/barometer |
| Skin-temperature variation (overnight) | **Built-in GPS** — Connected-GPS (phone) only |
| Sleep + stages (deep/light/REM/wake) + Sleep Score | |
| Steps, distance, calories/BMR | |
| Active Zone Minutes, Cardio Load | |
| **Daily Readiness Score** (Google made it free) | |
| VO2max / Cardio fitness (basic) | |
| AFib / irregular-rhythm notifications (passive) | |

**Premium ($9.99/mo, 3mo free w/ Air):** only the Gemini AI Health Coach +
adaptive plans + deeper analytics. All raw metrics above are FREE. We build
our own coaching (PT Coach) so Premium is not required for our features.

## 2. Metric inventory vs what we store today

Today `health_metrics` (point-grain, migration 041) + `health_workouts` hold,
from Apple: steps, active/basal energy, heart_rate, resting HR, HRV, SpO2,
respiratory rate, sleep_analysis (aggregate sessions), weight/body-fat/BMI,
misc mini-metrics.

- **Already have, Fitbit will improve granularity:** heart_rate (Fitbit ~2s vs
  Apple ~1/min — finer), steps, distance, active/basal energy, resting HR, HRV,
  respiratory rate, SpO2, skin temp, weight (if logged).
- **New from Fitbit (not tracked today):** Active Zone Minutes, Cardio Load,
  **Daily Readiness Score**, VO2max/Cardio fitness, AFib notifications,
  Fitbit-native **Sleep Score + efficiency** (their value, measured — OK to
  DISPLAY per the "don't compute our own, showing a native one is fine" rule).
- **Won't exist (don't build UI expecting them):** floors, ECG waveform,
  EDA/stress. Remove/hide any reliance once Fitbit is the sole source.

## 3. THE architecture fork (decide first — cheap empirical test)

**Does Fitbit Air data reach Apple HealthKit?** Fitbit devices historically do
NOT write into HealthKit (separate silo). If that still holds for the Air:

- **Branch A — Air writes to HealthKit** (unlikely, but TEST it): then the
  EXISTING Health Auto Export pipeline already carries Air data — near-zero new
  code, just source-tagging + dedup (§4). **Test the moment the device arrives:**
  wear it a night, then check iPhone → Health app → does Fitbit sleep/HR appear?
  If yes, Branch A.
- **Branch B — Air data stays in Google Health only** (expected): build a
  **Google Health API** integration (the confirmed Fitbit Web API successor,
  `health.googleapis.com/v4`, legacy Fitbit API dies Sept 2026):
  - Google OAuth 2.0, scopes `googlehealth.*.readonly` (sleep, activity,
    metrics). **Unverified-app path = ≤100 users, no CASA needed** → perfect
    for single-user personal use. Rate limits ample (300 req/min/user).
  - **Webhook push** (`projects.subscribers`): Google POSTs to our HTTPS
    endpoint with OUR secret in the Authorization header — SAME Bearer-secret
    pattern as `health-export-webhook`/`hevy-sync`. New edge function
    `google-health-webhook` (verify_jwt off, secret in Vault).
  - Read methods: `dailyRollUp`/`rollUp` for summaries, `list` for intraday,
    `reconcile` for merged streams. Sleep comes as timestamped stage SEGMENTS
    (`stages[]`) → real hypnogram, no aggregate ambiguity.

## 3b. BOTH sources visible, per-metric DEFAULT, AI reads the default (user req)

The user wants to SEE data from BOTH the Apple Watch and the Fitbit Air on the
site — not one silently replacing the other. Design:

- **Per-metric default source.** Each metric has a default (some default to
  Apple Watch, some to Fitbit Air — chosen by which device measures it better;
  see the comparison table in §3c). A day's headline/chart shows the default
  source; when the other source also has data, the user can flip to it (a small
  per-section source switch: `Apple Watch ⇄ Fitbit Air`, or "both" overlay).
- **Persisted user preference.** The chosen default per metric is stored
  (localStorage like `useDayTargets`, or a small `health_source_prefs` table if
  it must be AI-readable server-side). Shipping defaults are sensible
  (continuous/sleep → Fitbit; ECG/gait/workout-GPS → Apple) and the user can
  override any metric permanently.
- **AI reads the DEFAULT unless told otherwise.** The daily briefing, PT Coach,
  Ask-AI `get_health_stats`, and Daily's HealthCard all resolve each metric to
  its default source. If the user explicitly asks ("show me Apple Watch steps",
  "Fitbit'e göre uykum"), the AI/UI reads the requested source instead. So the
  aggregation layer must be source-aware (filter by `source_family`) and expose
  a `preferredSource(metric)` resolver that both UI and AI call.
- Implementation: `healthAggregate` gains an optional `sourceFamily` filter on
  every compute fn; a `useHealthSourcePrefs` hook holds the per-metric default;
  `get_health_stats` (ai-proxy) accepts an optional source arg, else uses the
  stored default.

## 3c. Apple Watch vs Fitbit Air — metric comparison + default map

Guiding rule: **Fitbit Air worn ~24/7** (off ≤1–2h/week) → default for anything
continuous/passive/overnight. **Apple Watch richer sensors + GPS** but worn
intermittently → default for workouts, clinical, gait, environmental.
Confidence: ✅ confirmed · ⚠️/❓ verify against a real API payload.

### UNIQUE to Fitbit Air (Apple Watch can't give these)
- **Active Zone Minutes** ✅
- **Daily Readiness Score** ✅ (now FREE, no Premium)
- **Cardio Load** (cardiovascular strain) ⚠️
- **Sleep Score + sleep efficiency** as native scores ⚠️❓ (Apple has NO sleep score) — OK to display (native measurement, per the "don't compute our own" rule)
- First-class **sleeping heart rate** ✅
- Practical superpower: **24/7 coverage** of every passive metric (fewest gaps)

### UNIQUE to Apple Watch (Fitbit Air can't — no sensor)
- **ECG** single-lead trace ✅ (Air has no electrodes)
- **Floors climbed / elevation** ✅ (Air has no barometer)
- **Full gait & mobility suite**: walking speed, step length, double-support %,
  asymmetry %, **walking steadiness**, six-minute walk, stair ascent/descent ✅
- **Running dynamics**: power, ground-contact time, vertical oscillation, stride ✅
- **Cardio recovery (1-min)**, **walking HR average** ✅
- **Environmental + headphone audio exposure**, **time in daylight**,
  **mindful minutes**, **handwashing**, **stand hours** ✅
- Workout **GPS route/pace** fidelity ✅
- **EDA/stress**: NEITHER device has it (Air has no EDA; Apple Watch never did)

### BOTH provide — one is clearly better
| Metric | Better source | Why |
|---|---|---|
| Continuous HR | **Apple** fidelity / **Fitbit** coverage | Air PPG accuracy flagged weaker; split: Apple in workouts, Fitbit all-day/overnight |
| Sleep stages | **Fitbit** | Heritage staging + actually worn to bed (Apple often charging). Note taxonomy: Apple **Core** ≈ Fitbit **Light** |
| VO₂max | **Apple** | Estimates from many activities; Air only from GPS outdoor runs |
| SpO₂ / respiratory rate | **Fitbit** | Reliable nightly (always worn; no US-unit SpO₂ hardware caveat) |
| Basal/active energy | **Fitbit** | 24/7 wear avoids the off-wrist basal under-count (our current gap-fill hack) |

### Default source map (ship these; user can override per metric)
- **Default → Fitbit Air:** resting HR, HRV, SpO₂, respiratory rate, skin temp,
  ALL sleep (duration/stages/score/efficiency/sleeping-HR), Daily Readiness,
  Cardio Load, Active Zone Minutes, all-day steps/distance/calories/active+basal
  energy, passive AFib monitoring.
- **Default → Apple Watch:** ECG, floors, full gait/mobility suite, running
  dynamics, cardio recovery, walking HR avg, VO₂max, environmental/headphone
  audio, time in daylight, mindful minutes, stand hours, handwashing, and any
  workout with GPS/route/pace.
- **Context split:** continuous HR → Fitbit for daily/resting/overnight, Apple
  during logged workouts.
- **Neither / single manual source:** EDA-stress (impossible), blood glucose
  (external CGM), body mass/fat/BMI (scale or manual — keep ONE source).

### New metric_names to add (with METRIC_AGGREGATION class + mini-card/section)
`active_zone_minutes` (sum), `cardio_load` (latest/sum ❓), `daily_readiness`
(latest), `vo2max` (latest), `sleeping_heart_rate` (latest), `fitbit_sleep_score`
(latest), `fitbit_sleep_efficiency` (latest). Apple-side already-modelled ones
(walking_steadiness, walking_speed, six_minute_walk, etc.) stay as-is.

### ❓ Verify against a live payload before wiring
Whether Google Health API exposes numeric **Sleep Score / Cardio Load / Daily
Readiness** as fields (vs app-only); Apple unit's **SpO₂** status; current
**Premium** gating on deep history. Confirm on first real OAuth pull.

## 4. Apple ↔ Fitbit dedup ("single winner source per metric per day")

Both sources will report overlapping days. Rule:
- **Fitbit = primary** for the metrics it tracks (worn 24/7). Apple = fallback
  ONLY for the window Fitbit was off (the weekly ~1–2h charge, or a not-yet-
  synced gap). Never show both summed.
- Implement as a **source-priority resolver** in `healthAggregate.ts`: when a
  day/metric has both sources, take Fitbit; splice Apple only for time ranges
  with no Fitbit sample (so a charge-window nap from the Watch still counts).
- **Charge window is NOT a data gap to alarm on** — expect one ~1–2h hole/week;
  don't flag it as missing.
- Tag every row's `source` clearly (already a column). Add a stable source
  family tag (`fitbit` vs `apple`) so the resolver keys off family, not the
  raw per-device string (Apple already varies: "Furkan's Apple Watch" vs
  "…|Lasci").

## 5. Schema additions

- **`health_sleep_segments`** (NEW) — the real fix for sleep: one row per
  timestamped stage segment (`user_id, start, end, stage, source, source_family`).
  Enables an actual hypnogram and makes overlapping-aggregate ambiguity (the
  2026-07-17 bug) impossible — the true night = union of non-overlapping
  segments. `sleep_analysis` aggregate rows stay for back-compat / Apple.
- **`health_metrics`** — no schema change needed; new metric names
  (`active_zone_minutes`, `cardio_load`, `daily_readiness`, `vo2max`,
  `fitbit_sleep_score`, `fitbit_sleep_efficiency`) slot in as new
  `metric_name`s with the same point-grain shape. Add their aggregation class
  to `METRIC_AGGREGATION` + a mini-metric card each.
- Add `source_family` (text, `apple`|`fitbit`|`manual`) to `health_metrics`
  and `health_workouts` for clean dedup keying.

## 6. Prep achievable BEFORE the device arrives (no Fitbit data needed)
1. ✅ This design doc (committed).
2. Sleep-segment table migration (write now, apply when building Branch B).
3. Source-priority resolver scaffolding in `healthAggregate.ts` (testable
   against existing multi-source Apple rows).
4. Google Cloud project + OAuth client creation is a USER step (console);
   document the exact steps + scopes here when starting Branch B.
5. Interim Apple sleep fix (user, on phone): add the **"Previous 7 Days"
   reconciliation** Health Auto Export automation so fragmented nights
   (like 2026-07-17, which lost its early ~3h session) get re-sent whole.

## 7. Open decisions (need user)
- Confirm Branch A vs B with the arrival test (§3).
- Poll vs webhook for Branch B (webhook preferred; poll simpler to start).
- Which new metrics get a full section vs a mini-card.
- Keep Apple pipeline running in parallel indefinitely, or retire it once
  Fitbit is trusted?
