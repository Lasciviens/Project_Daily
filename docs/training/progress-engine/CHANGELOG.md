# Changelog

## Display-only changes after 2.1.0 (27.09.2026, no version bump)

No decision, target or evidence level changed, so `ALGORITHM_VERSION` stayed 2.1.0:

- `CanonicalSet.rpe` carries `hevy_sets.rpe` through `normalize.ts` for display only;
  `format.ts` adds " @ RPE 8/9/10" (via `setFormat.rpeSuffix`) where a logged session is
  shown — Last time, session lists, the chart tooltip, the coach. No engine function reads
  it (see `DATA_AND_LIMITATIONS.md`).
- Personal-record events are kept off every screen (`copy.ts` `visibleEvents`); the engine
  still emits them and they still count as evidence for the program verdict.

## 2.1.0 — targets for every session shape, unit-aware trends (27.09.2026)

From the Training audit (commit `a8b89cfa`, "Training + Health: fix the audited bugs and
data paths"). `ALGORITHM_VERSION` 2.0.0 → 2.1.0.

- **Next targets for every session shape.** A top-set + backoff session keeps each set's
  OWN load in the plan (prescribing the backoff reps at the top-set weight was a real bug),
  and only the top set's load goes up. Every "stay at this load" action gets double
  progression: keep the load, add one rep (or five seconds on a timed hold) to the first set
  below the minimum, else below the top of the range; a set that dropped since last time
  means "get back to last time". The first session of an exercise already gets such a plan.
  A bodyweight movement ready to progress is told to add weight or a harder variation.
  When no numeric target can be given, `nextTargetBlocker` says why (`no_sets`,
  `mixed_load`, `set_count_mismatch`, `missing_values`, `action`).
- **READY_TO_INCREASE for top-set + backoff schemes:** a complete session whose top set is
  at the top of the range and whose backoff sets all clear the minimum now qualifies (before,
  such a scheme could never be told to add load).
- **Routine targets from the routine's own sets** (`policies.ts` `routineTargetFromSets`):
  warm-ups **and dropsets** are excluded (counting a dropset made a 3-set + dropset routine
  demand 4 sets forever and blocked "Ready to increase"); with no rep range, the fixed reps
  are the target, so a 5×5 is 5–5.
- **No generic default for bodyweight reps** (it was 10–15, which made sub-10 pull-up
  progress read "below the minimum"): without a saved target every extra rep counts.
- **Unit-aware, symmetric trend thresholds.** Timed and distance totals use floors relative
  to their own mean (4 % noise, 1 % slope — `relativeNoiseFloor`, `relativeSlopeFloor`)
  instead of the 1-rep floor, which meant a plank could never read ACCUMULATING or
  POSSIBLE_PLATEAU. ACCUMULATING and DECLINING now need the same evidence: a slope past its
  floor AND either a low-noise series or a one-sided 95 % t-test on the slope (before, only
  improvement needed low noise).
- **New action `LOG_COMPARABLE_SESSION`** for a session that could not be compared at all
  (mixed loads, nothing the metric reads); it used to read HOLD_STEADY, which is now
  "Repeat and add a rep". `observedTransition` is direction-aware, so any LOAD_DECREASED
  (a lighter weight, or more assistance) is REVIEW_LOAD_REDUCTION.
- **One estimated 1RM per session** (`metricStrategy.ts` `sessionBestE1rm`: the set with the
  best e1RM value) used by current state, the estimated-strength event and the charts; one
  `EST_1RM_MAX_REPS`.
- **Event names say what the engine sees:** the loaded history is the last 6 months of the
  current program, so a "Load PR" became "Best load (6 months)", and so on.
- New catalog codes `REPS_UNCHANGED`, `REPS_DECLINED`, `LOG_COMPARABLE_SESSION` and one entry
  per data-quality flag (`DATA_QUALITY_FLAG_CODE`), so the UI never shows a raw enum.
- **Code moved into the engine:** `program.ts` (the program verdict, from the deleted
  `progressDecisions.ts`; `progressCopy.ts` deleted too), `weeklyChanges.ts`, `format.ts`,
  `chartSeries.ts` (the trend chart draws the engine's own numbers).
- **The engine runs once per page** instead of once per card (today
  `progressModel.ts` via `TrainingProgressProvider`, see `README.md`).

`scripts/verify-progress-engine.cjs` grew with these cases (329 assertions as of
13.10.2026); `scripts/verify-progress-decisions.cjs` now covers only the program decision.

## 2.0.0 — Phase 2-5 rewrite (03.09.2026)

Full replacement of the per-exercise pieces of `progressDecisions.ts`
(`ExerciseDecision`, `computeExerciseDecision`, `ExposureSummary`,
`CurrentStateSummary`) with `src/features/training/progress-engine/`,
approved across several rounds of algorithm review. Highlights:

- Complete ordered set vectors preserved end to end (never reduced to a
  single "best set" before the UI); `hevy_workouts.title` and
  `hevy_sets.index` now actually selected and used.
- Session identity is `workout_id`, not date alone (already correct at the
  aggregation layer; now explicit throughout the new engine too).
- `observedTransition` / `repDelta` / `rangeCompliance` / `evaluationScope`
  / `dataQualityFlags` / `currentAction` kept as independent facets —
  never one collapsed status. A data-quality issue (missing/extra sets, a
  mixed-load session) never silently replaces the factual transition; it
  narrows the evaluation scope and downgrades recommendation evidence
  instead.
- Two structurally separate trend axes: a configurable-window
  `recentProgressTrend` (default 8 sessions, always disclosed) and a
  load-cycle-scoped `currentLoadProgress`. All-history PR/event detection
  is never windowed.
- `linearFit`'s directional-consistency measure replaces the retired
  `repRangeVariedSignificantly` (top-set-only, needed a bolt-on "explained
  by a weight change" patch) — a monotonic climb never misreads as high
  variation.
- `SessionLoadStructure` (`uniform_working_load` / `top_set_and_backoff` /
  `mixed_load`) — a session's sets are never collapsed to one `weightKg`
  when they don't share one clean load.
- A raw load decrease is neutral (`REVIEW_LOAD_REDUCTION`) for
  external-load metrics — never auto-labeled "deload" — but the SAME raw
  decrease is the positive direction for assisted-bodyweight exercises,
  via one centralized `isPositiveLoadChange` inversion.
- Next Target carries a real per-set-position floor (`minimumSetReps`), not
  just a total — a candidate that regressed on one set fails even if its
  total matches.
- `RULE_CATALOG` + a documentation-sync verification (every emittable
  code has an entry, classified by evidence tier).
- Weekly Muscle Dose (`MuscleDoseSummary.tsx`) removed — superseded,
  confirmed zero remaining consumers before deletion. `muscleMap.ts` and
  every other muscle-mapping consumer (Muscles tab,
  `WeeklySetsPerMuscleChart`, `TrainingInsightsPanel`) untouched.

`scripts/verify-progress-engine.cjs` — new, 72 assertions.
`scripts/verify-progress-decisions.cjs` — 85 → 76 assertions (the 9
removed were exclusively about the deleted `computeCurrentWeekMuscleDose`;
`computeProgramDecision`'s own assertions are unchanged and still pass).
