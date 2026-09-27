# Training + Health overhaul — handoff

Paused on 2026-09-27 at the owner's request ("note the plan and what was stopped; continue when I say so").
Branch `claude/charming-newton-yhk8i`, PR #499. **The branch builds cleanly** (tsc, eslint, `npm run build`, every `scripts/verify-*.cjs`): nothing was stopped mid-edit — wave 2 finished before the pause.

Delete this folder once the work below is done and CLAUDE.md is updated.

## Goal (owner's words, condensed)

- **Health** becomes its own page, refurbished: better look, better graphs and stats, and science-based context ("is this good or bad for a man my age?") for the most important / most searched / most data-available metrics — **not centred on VO2 max** (explicit owner correction).
- **Training** is "the reason this website exists": see *my plan*, *my improvements*, *what to do next* (science, real sources), stats and explanations. Clean core and hooks; remove duplicates where the same user-facing thing goes to the DB different ways; fix bugs.
- **Cut report** (owner request): "How am I doing on my cut? Does my scale match my calorie deficit? Am I losing as much as I should?" plus trend stats.
- Owner also wants a few **new** things (see Extras).

## What landed (commits on the branch)

1. `Health: move to its own feature folder and page` — `src/features/health/**`, route `/#/health`, nav entry (Life group, More sheet), shared charts in `src/shared/components/charts/`. Training lost its Health tab; Daily's Health card links to `/health`.
2. `Shared: localDayOf and mondayOfStr` — `src/shared/utils/dateUtils.ts` (file timestamps under the local day, never `iso.slice(0,10)`).
3. `Training + Health: fix the audited bugs and data paths` (wave 2, 151 files):
   - Health data core: `healthWindowStats.ts` (one window rule for every headline), hooks with aggregation in `select`, `useLatestHealthValue` (VO2 max etc. no longer blank), `bodyweight.ts` + `useBodyweightSeries`/`useLatestBodyweight` (Hevy > smart scale > Apple), minute-grain collapse rule, gaps not zeros, sleep stage bar fixed, error boundaries, workouts load raw payload on open. New verify scripts: `verify-health-window-stats`, `verify-bodyweight`.
   - Health science: `src/features/health/benchmarks/healthBenchmarks.ts` (`classify`, `BENCHMARKS`, `vo2Explain`, `ageOn`), `healthGuidance.ts` (`buildHealthInsights`), `components/profile/HealthProfileCard.tsx`, migration **110** (birth_year, sex, height_cm on `athlete_profile`), `verify-health-benchmarks`.
   - Training engine: targets for top-set+backoff, repeated reps, fixed-rep routines; dropsets; unit-aware thresholds; weekly series zero-filled to the last complete week; ONE `est1RM` and ONE `sessionsThisWeek`/`sessionsInWeek` (progressAggregate); engine runs once; `progressDecisions.ts`/`progressCopy.ts` deleted, `computeProgramDecision` now in `progress-engine/program.ts`; `suggestCurrentProgramRoutineIds`.
   - Hevy side: PRs from every set (one definition), workouts ordered by start_time + local-day filing, calendar range fetch + trained days marked done, Log-workout payload per Hevy schema, routine delete explained (Hevy API has no DELETE) + sync prunes routines missing from a complete listing, per-type set formatting, body-measurement modal + hevy-api merge fixes, Strava OAuth callback.
4. Earlier on the same PR: ScreenScraper video player, per-card storage cost in the scrape review.

Full per-agent notes (exports, skipped findings, integrator follow-ups): `wave2-integrator-notes.txt`. Audits: `audit/*.json`. Research (fact-checked): `research/*.json` — where a `verify-*.json` correction says wrong/imprecise, the correction wins.

## Deploy steps once merged

- Apply `supabase/migrations/110_athlete_health_profile.sql` (the client works before it is applied).
- Redeploy `hevy-api` (JWT on) and `hevy-incremental-sync` (whitelisted workout keys, explicit-null merge, stop on failed read, PUT→POST fallback; routine pruning only after a complete listing).
- Open question for a live check: Hevy's OpenAPI names `abdomen, waist, hips, left_thigh…` without `_cm`; our functions send/read `abdomen_cm` etc. One GET of `/v1/body_measurements` settles it.
- Optional: `UPDATE health_metrics SET source_family='manual' WHERE source='manual';` (old manual sleep rows).

## Remaining plan (in order)

### 1. New Health page layout (driven by the metric ranking)

Tiering from `research/research-rank.json` (scores: evidence, availability on Series 11 + iPhone, real interest data, actionability). Tier 1 = daily hero, 2 = own section with ranges, 3 = compact card when data exists, 4 = omit.

| Tier | Metric | Key | Best view |
|---|---|---|---|
| 1 | Sleep duration | sleep_analysis (asleep duration) | Last night's ASLEEP time plus the 7-night average against a 7 h line. A 30-night bar chart with the same refer |
| 1 | Daily steps | step_count | 7-day average vs a 7,000-8,000/day band, with today's running count as a secondary line. A 90-day trend with a |
| 1 | Weekly exercise minutes | apple_exercise_time (weekly total) + Hev | Rolling 7-day (or Mon-Sun) total vs a 150-min line, with strength days pulled from Hevy vs the WHO ≥2/week. We |
| 1 | Sleep regularity | sleep_analysis (derived: bed/wake timing | The spread (SD, minutes) of wake time and sleep-onset over the last 14 nights, shown as a bed/wake timeline of |
| 1 | Resting heart rate | resting_heart_rate | 7-day average vs a personal 60-day baseline (delta in bpm), with NHANES percentiles as context only. A 6-month |
| 1 | Weight trend | weight_body_mass + body_composition_repo | One merged 7-day moving-average line, with raw weigh-ins as dots, and the kg/week slope over the last 28 days. |
| 2 | Heart rate variability (SDNN) | heart_rate_variability | 7-day rolling mean vs the personal 60-day mean ±1 SD band (Plews-style). Use overnight readings only if they c |
| 2 | Cardio fitness (VO₂ max estimate) | vo2_max | In a Cardio fitness section: the latest estimate WITH its date and 'N days ago', a ±6 ml/kg/min uncertainty ba |
| 2 | Active energy (Move) | active_energy | Daily bars vs the owner's own Move goal plus the weekly total. Active + basal as a TDEE trend handed to Food g |
| 2 | Breathing disturbances | breathing_disturbances | 30-night chart with Apple's own Elevated / Not elevated classification if exported; otherwise the nightly coun |
| 2 | Blood oxygen (SpO₂) | blood_oxygen_saturation | Per-night average and lowest reading vs the personal range, with a 95% reference line, inside the Overnight vi |
| 2 | Respiratory rate (sleep) | respiratory_rate | Nightly value vs the 30-day personal median with a ±1.5 br/min band, inside Overnight vitals. |
| 2 | Body fat % | body_fat_percentage + body_composition_r | A 4-week moving average from ONE device, on the same chart as lean mass, with Gallagher bands as context. |
| 2 | Lean / muscle mass | lean_body_mass + body_composition_report | kg trend (28-day moving average) beside body fat on one chart; change per month; optionally beside Hevy volume |
| 2 | Flights climbed | flights_climbed | Daily flights with a ≥5 flights/day (~50 steps) reference line, and the 7-day average in the Activity section. |
| 2 | Waist-to-height ratio | waist_circumference (from Hevy) ÷ height | Latest ratio with its date and NICE band inside Body; monthly trend when there are ≥3 measurements. |
| 2 | BMI | body_mass_index + body_composition_repor | A secondary line under Weight in the Body section, computed from the 7-day average weight and height, with the |
| 2 | Cardio recovery | cardio_recovery | In Cardio fitness beside VO2 max: per-workout dots plus a 30-day median, compared only like-for-like (same wor |
| 3 | Heart rate (day range) | heart_rate | Day view only: a 24-h min-max band with sleep shaded. Not a trend tile, and never a daily average compared acr |
| 3 | Sleep stages & awake time | sleep_analysis (core/deep/REM/awake) | Inside Sleep: a nightly stacked bar with Awake as its own segment (shares of time in bed, not of sleep), plus  |
| 3 | Wrist temperature (sleep) | apple_sleeping_wrist_temperature | Nightly deviation (°C) vs the personal range as a small sparkline inside Overnight vitals; flag only multi-nig |
| 3 | Stand hours | apple_stand_hour, apple_stand_time | A compact 'x of 12 hours with a break' strip in Activity, framed as sitting breaks, not exercise. |
| 3 | Walking + running distance | walking_running_distance | A secondary figure under the Steps chart (km today and 7-day average). |
| 3 | Resting (basal) energy | basal_energy_burned | Folded into an active + basal = daily burn figure in Activity; a warning chip if outside a plausible band for  |
| 3 | Walking heart rate | walking_heart_rate_average | A 90-day trend with a 14-day moving average, in the Heart/Cardio section as a daily fitness proxy. |
| 3 | Physical effort (METs) | physical_effort | A compact card in Cardio fitness or Activity; its main use is behind the scenes (intensity context for exercis |
| 3 | Walking speed | walking_speed | A Mobility card with a 90-day trend and the ≥1.0 m/s reference; highlight only a sustained decline. |
| 3 | Gait: asymmetry, double support, step length | walking_asymmetry_percentage, walking_do | Compact Mobility cards with a 90-day trend; flag only a sustained change from the personal baseline. |
| 3 | Stair speed | stair_speed_up, stair_speed_down | A compact Mobility card with a trend line. |
| 3 | 6-minute walk (estimate) | six_minute_walking_test_distance | Latest estimate with its date in Mobility. |
| 3 | Walking steadiness | walking steadiness (HKQuantityTypeIdenti | Only if data appear: the latest classification with its date in Mobility. |
| 3 | Time in daylight | time_in_daylight | Daily minutes with a 7-day average in a 'Daily habits & environment' row; a winter/summer comparison is inform |
| 3 | Toothbrushing | toothbrushing | Sessions per day (target 2) and total time in the habits row. |
| 3 | Running dynamics & cycling distance | running_speed, running_power, running_st | Inside the workout detail for that run or ride only, never as permanent cards showing dashes on other days. |
| 3 | More from the smart scale | body_composition_reports: visceral_fat_i | A collapsed 'More from the scale' table with a history row; no bands and no hero use. |
| 3 | Health alerts & ECG | Health notifications (irregular rhythm,  | A conditional strip at the top of the page, rendered only when an event exists in the window (date, type, and  |
| 4 | Headphone audio exposure | headphone_audio_exposure | (If re-enabled) 7-day exposure as % of the WHO weekly dose, not daily dB averages. |
| 4 | Ambient noise | environmental_audio_exposure | Hidden. |
| 4 | Mindful minutes | mindful_minutes | Hidden; Breathe-session HRV already lands in the HRV series. |
| 4 | Handwashing | handwashing | Hidden. |
| 4 | AFib burden | AFib History / atrial fibrillation burde | Hidden unless rows appear. |
| 4 | Nutrition intake | dietary_water, protein, carbohydrates, t | A 'Nutrition lives in Food' link from the Activity/TDEE area. |
| 4 | Composite scores (Sleep Score, scale body score) | Apple Sleep Score (watchOS 26), body_com | Omit. |
| 4 | Not applicable / dead / private | push_count, uv_exposure, sexual_activity | Hide; keep the aggregation rules so historical rows don't fall through. |


Hero proposal (from the ranking agent):

HERO: 6 tiles, in this order. No composite health score, per the house rule. Each tile shows the value, the change vs the previous window, one colour band against a cited reference, and one line of why it matters.
1. SLEEP: last night's asleep time + 7-night average vs ≥7 h (AASM/SRS). Second line: wake-time spread over 14 nights (regularity; Windred 2024). It is first because it is the only complete result each morning and the most-searched wearable topic (2.5x heart rate).
2. STEPS: 7-day average vs a 7,000-8,000/day band (Paluch 2022, Ding 2025), with today's running count underneath.
3. EXERCISE THIS WEEK: rolling 7-day moderate-equivalent minutes vs 150, plus Hevy strength days vs ≥2 (WHO 2020).
4. RESTING HR: 7-day average vs the personal 60-day baseline in ±bpm (Zhang 2016 / Aune 2017 context).
5. WEIGHT: 7-day moving average + kg/week over 28 days, with the date of the last weigh-in. BMI and WHtR as small secondary text.
6. OVERNIGHT VITALS: HRV 7-day vs its personal ±1 SD band as the headline number, plus a status line 'all in your usual range' / 'N outside your range' across HRV, respiratory rate, SpO₂, wrist temperature and sleeping HR. This is modelled on Apple's own Vitals app (a count of outliers vs your own range, not a weighted score). If that feels too close to a score, swap it for a plain HRV-vs-baseline tile.
VO₂ max is deliberately NOT a hero tile. It is sporadic (only estimated on Outdoor Walk, Run or Hike workouts; about 2 run days since July), reads 4.5-6.3 ml/kg/min low, and only 14% of people land in the right band. It leads the Cardio fitness section instead, showing its date.

SECTION ORDER:
0. Alerts strip (conditional): rendered only when an event exists in the window: irregular rhythm, high/low HR, hypertension, sleep apnea notification, ECG, fall. This needs Health Auto Export's notification arrays ingested first.
1. Hero (the 6 tiles above).
2. Sleep:
   - asleep-time bars with a 7 h line
   - bed/wake timeline and regularity spread
   - stages as a stacked bar with Awake as its own segment and an accuracy note
   - breathing disturbances over 30 nights
3. Activity:
   - steps (+ distance as a secondary figure)
   - weekly exercise minutes + Hevy strength days
   - active energy vs Move goal
   - flights climbed with a ≥5/day line
   - stand hours framed as sitting breaks
   - daily burn (active + basal) handed to Food
4. Heart & overnight vitals:
   - resting HR vs baseline
   - HRV band
   - SpO₂ with the 95% line
   - respiratory rate
   - wrist temperature deviation
   - walking HR trend
   - day heart-rate range (day view only)
5. Body:
   - merged weight 7-day average + kg/week
   - body fat and lean mass on one chart from one device
   - waist-to-height when a Hevy waist exists
   - BMI as context
   - collapsed 'More from the scale'
6. Cardio fitness:
   - VO₂ max (latest + date + ±6 band + FRIEND/HUNT3 placement; dots over 6-12 months)
   - cardio recovery per workout, like-for-like only
   - physical effort
7. Mobility (compact cards):
   - walking speed with the ≥1.0 m/s line
   - step length, asymmetry, double support
   - stair speed
   - 6-minute walk estimate
   - walking steadiness only if rows appear
8. Daily habits & environment:
   - time in daylight
   - toothbrushing
   - headphone weekly dose only if the owner re-enables it
9. Workouts: Apple workouts with HR curves. Running dynamics and cycling distance live inside the workout detail, never as permanent cards.

HIDDEN (tier 4): ambient noise, mindful minutes, handwashing, AFib burden, HealthKit nutrition (link to Food instead), Sleep Score / scale body score, push count, UV, sexual activity, legacy Fitbit names.

Build on: `useMetricWindow`/`useSleepWindow`/`useHeartWindow`/`useEnergyWindow` (hooks/useHealthWindow.ts), `summarizeWindow`, `personalBaseline`, `rollingMean`, `linearTrendPerDay` (healthWindowStats.ts), `classify`/`BENCHMARKS` (benchmarks), `buildHealthInsights`, `HealthTrendChart` (band/refLines props), `HealthProfileCard`. Read `?date=&period=` query params in HealthPage (Daily links with them). No composite health score (house rule). Include **trend stats** for each key metric: 7/30/90-day change, weekly rate, best/worst week, variability vs previous period.

### 2. Cut report (new)

Pure module (e.g. `src/features/health/cut/energyBalance.ts`) + verify script + a card on Health (Body) and possibly Food · Today:
- Intake: eaten `food_log_entries` totals per day (derived totals, migration 106), **logged days only**, with a completeness %.
- Expenditure: Apple active + basal energy per day; also compute an **observed TDEE** = mean intake − (Δtrend weight × energy density) / days, and compare with Apple's figure (Apple energy is known to read high; logging commonly misses 10–30% — cite sources).
- Weight: smoothed trend from `useBodyweightSeries` (7-day moving average or least squares over 28 days); rate in kg/week and % bodyweight/week (Garthe 2011: ~0.7%/wk preserved lean mass better than ~1.4%/wk).
- Expected vs actual loss (≈7,700 kcal/kg for fat; early loss includes water/glycogen — verify the energy-density figure against Hall 2008 / Thomas 2013 before shipping), verdict "as expected / slower / faster" with the likely reason and a confidence note (days logged, weigh-ins).
- Fat vs lean change from the smart scale (`body_composition_reports`), protein g/kg vs cut guidance (research-science.json: Morton 2018 breakpoint 1.62 g/kg, CI to 2.2; Helms for cuts), projected goal date. `day_targets.goal`/calories give the plan.

### 3. Training information architecture

Tabs **Next · Program · Progress · Log · Library · Coach** (Strava merged into Log as a filter):
- **Next** (default): next planned session (one hook — see Dedupe) with every exercise's engine target per set (incl. backoff weights), last session's numbers, GIF; if nothing is planned, the least-recently-trained routine of the current program; one line of recovery context (last night's sleep, resting HR vs baseline — no score); alerts ("2 lifts ready to increase", "Bench flat for 5 sessions").
- **Program**: current-program routines (picker moved here from Coach → Profile; use `suggestCurrentProgramRoutineIds`), weekly schedule, each routine's exercises with set/rep targets + an editor for `exercise_target_overrides`, planned weekly sets per muscle vs MEV–MAV (science guidance with sources), push:pull and quad:ham balance, respecting limitations and muscle preferences (preferences are saved but read by nothing today).
- **Progress**: 4/12/26-week window, lifts improved, e1RM change for main lifts, one PR timeline, bodyweight next to relative strength, the decision table with a dated per-exercise chart, weekly volume / sets per muscle / consistency vs target, engine-fed insights.
- **Log**: workout list + calendar + detail, Strava + Apple Watch workouts (link Apple strength workouts to the matching Hevy session by time overlap for HR).
- **Library**: exercises (GIF fixes), routine editor.
- **Coach**: AI assessment fed by the engine's decisions and the program (today it works from a hard-coded split and can contradict Progress), plus profile, limitations, preferences.

### 4. Dedupe round (follow-ups the wave-2 agents could not do — files they did not own)

- Bodyweight consumers → `useBodyweightSeries`/`useLatestBodyweight`/`fetchBodyweightSeries`: `useNutritionCoach`, `BodyMeasurementModal` chips, `ptCoachApi`, `coachContext`, `hevyApi.fetchBodyweightHistory` → `useProgressData`/`RelativeStrengthChart`, `BodyMeasurementsTab` Latest card; `useUpsertBodyMeasurement` should invalidate `qk.health.bodyweightAll`; delete unused `qk.training.bodyComposition`.
- One "next training session": `useNextTrainingSession`/`pickNextTrainingSession` (exported by the Hevy agent) in `NextSessionBanner`, Daily `TrainingCard`, Home `useTodayOverview`.
- Sessions this week via `sessionsThisWeek`/`sessionsInWeek` in HevyTab, Home `useWeekTrainingStats`, `ptCoachApi`.
- `CurrentProgramPicker`: use `suggestCurrentProgramRoutineIds` (it still uses routine edit time) and drop its stale comment.
- `hevyApi.ts`: paginate `hevy_workout_exercises`, `.order('id')` on every paged read (check what the Hevy agent already did).
- One AI coach context builder (PT Coach tab and Ask-AI Coach mode) fed by engine decisions + program + limitations; limitation free text shows 'undefined' in the prompt and a blank name in LimitationsList.
- `WorkedMuscles` (807 lines) re-implements muscleMap helpers and restriction logic with different semantics — unify and split; `TrainingCalendar` split.
- `ai-proxy` `collapseDuplicateSumPoints`: mirror the new minute-grain rule (hour has ≥7 distinct minutes → sum minute rows; else boundary row or largest) + `verify-ai-health-stats-dedup.cjs`; `computeSleepNights` (ai-proxy) and `computeSleepNightsGw` (phone-gateway) ignore manual sleep rows.
- `BarLineChart`: remove the unused `onPointClick` + in-tooltip button.
- Remaining findings marked skipped in `wave2-integrator-notes.txt`.

### 5. Extras (owner asked for new things; cut for time)

Warm-up set generator for a lift's top set; muscle recovery map (days since each muscle was last trained); fitness age from VO2 max; VO2/cardio plan card (Strava/Apple cardio sessions vs target); weight trend projection; sleep regularity chart.

### 6. Finish

Adversarial review (correctness, data paths, science claims vs sources), harness screenshots at 393 / 1469 / 2450 (light + dark), CLAUDE.md (Health section → its own feature, Training IA, new modules, verify counts, deploy steps), PR description.

## How to resume

Say "continue". Start from section 1–4 (they can run in parallel on disjoint files: Health page · Cut report · Training IA · Dedupe), then 5–6. The browser test harness used in this session lived in the ephemeral scratchpad; recreate it if needed (Vite on :5371 with a mocked Supabase — see earlier sessions' notes) or verify with `npm run build` + verify scripts + the E2E Playwright setup.
