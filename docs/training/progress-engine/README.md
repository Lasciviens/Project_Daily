# Exercise Progress Engine

The decision engine behind Training → Progress's per-exercise list. Answers,
per exercise: is this progressing, what changed since the last comparable
workout, is it time to add weight, and what's the exact next target.

## Where the code lives

```
src/features/training/progress-engine/
  types.ts          Canonical types — CanonicalExerciseSession, ExerciseProgressResult, etc.
  normalize.ts       Raw ProgressSetRow[] -> CanonicalExerciseSession[]; classifyLoadStructure
  comparability.ts   The per-pair read: observedTransition/repDelta/rangeCompliance/
                      evaluationScope/dataQualityFlags/currentAction
  trend.ts           recentProgressTrend (windowed) + currentLoadProgress (load-cycle-scoped)
  events.ts          Achievement detection over every loaded session (the last 6
                      months) — never windowed to the trend window; kept off screen
                      (copy.ts visibleEvents)
  targets.ts         Next Target generation with a per-set-position floor
  metricStrategy.ts  Per-metric dispatch: best set, eligible sets, comparable totals,
                      sessionBestE1rm — the one place direction (assisted = lower is better)
                      and the est1RM 12-rep ceiling live
  policies.ts        DEFAULT_POLICY, target-resolution hierarchy (routineTargetFromSets),
                      the assisted-weight metric inversion
  program.ts         Program-level reads: progressVerdict, workload, current-program
                      scoping (computeProgramDecision, filterToCurrentProgram)
  weeklyChanges.ts   "Big changes this week" — per-exercise jumps vs your own last month
  chartSeries.ts     The per-session series one exercise's trend chart draws
  format.ts          Set formatting for sessions and targets (RPE shown, never judged)
  ruleCatalog.ts     RULE_CATALOG — every reason/event/action code, classified by evidence tier
  copy.ts            Pure English copy formatter reading the catalog + structured result
  evaluate.ts        evaluateExerciseProgress() — the single orchestration entry point
  index.ts           Public barrel — import from here outside this folder
```

**The engine runs once per page.** `src/features/training/progressModel.ts`
(`computeProgressModel`, pure: no React, no Supabase) builds the canonical
sessions, runs the engine per exercise, takes the program decision and adds
the per-exercise muscle/routine metadata. Two callers:

- `TrainingProgressProvider` (`components/next/TrainingProgressProvider.tsx`)
  wraps the Training page's Next and Progress tabs, and the planned-session
  popup (`components/session/PlannedSessionBody.tsx`). It calls
  `hooks/useProgressData.ts` once — a thin wrapper that gathers the React Query
  data and memoises `computeProgressModel` — and shares the result through
  `ProgressDataContext`; every card reads it with `useProgressDataContext()`.
  Calling `useProgressData()` anywhere else would run the whole engine again.
- The AI coaches (`coach/coachData.ts`) call `computeProgressModel` directly
  on their own fetches, so the PT assessment and the Coach chat read exactly
  the decisions the Progress tab shows.

Rendered by `src/features/training/progress/ExerciseDecisionTable.tsx` (the
inline-expansion row/drill-down UI) and its trend chart
(`progress/ExerciseTrendChart.tsx`, from `chartSeries.ts`).

## Non-goals

- Not a training-load calculator. `dataQualityFlags`/`evaluationScope` exist
  specifically so the engine never pretends to have evaluated more than it
  actually saw.
- Not RIR/RPE-dependent: RPE is shown next to logged sets, never used in a
  decision. See `DATA_AND_LIMITATIONS.md`.
- Not a chart library. The chart in the drill-down (`BarLineChart`) is a
  presentation of `CanonicalExerciseSession[]`, not part of the decision
  logic.

## Verification

`scripts/verify-progress-engine.cjs` — 329 assertions (13.10.2026) against the
real un-mocked modules (sucrase, no live DB), covering `classifyLoadStructure`,
`buildCanonicalSessions`, `evaluatePair`, `buildNextTargets`, the trend
functions, event detection, full worked examples, and `RULE_CATALOG`
completeness. Run: `node scripts/verify-progress-engine.cjs`.
`scripts/verify-progress-decisions.cjs` (28) covers `program.ts`'s
program-level decision.

`scripts/verify-progress-filters.cjs` covers the decision table's filters
(`progress/decisionFilters.ts`: search, evidence, window, muscle, routine)
and the per-exercise muscle/routine metadata `progressModel.ts` hands them —
see `DATA_AND_LIMITATIONS.md`. The filters only choose which decisions are
listed; they never change one.

## Change history

See `CHANGELOG.md`. `ALGORITHM_VERSION` (in `policies.ts`) is stamped on
every `ExerciseProgressResult` — bump it whenever decision semantics change,
and update `CHANGELOG.md` in the same change.
