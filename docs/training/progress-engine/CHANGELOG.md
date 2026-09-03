# Changelog

## 2.0.0 — Phase 2-5 rewrite (this PR)

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
