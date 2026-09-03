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
  events.ts          All-history PR/achievement detection — never windowed
  targets.ts         Next Target generation with a per-set-position floor
  policies.ts        DEFAULT_POLICY, target-resolution hierarchy, the assisted-weight
                      metric inversion
  ruleCatalog.ts     RULE_CATALOG — every reason/event/action code, classified by evidence tier
  copy.ts            Pure English copy formatter reading the catalog + structured result
  evaluate.ts        evaluateExerciseProgress() — the single orchestration entry point
  index.ts           Public barrel — import from here outside this folder
```

Consumed by `src/features/training/hooks/useProgressData.ts` (builds sessions
+ runs the engine per exercise) and rendered by
`src/features/training/progress/ExerciseDecisionTable.tsx` (the inline-
expansion row/drill-down UI).

## Non-goals

- Not a training-load calculator. `dataQualityFlags`/`evaluationScope` exist
  specifically so the engine never pretends to have evaluated more than it
  actually saw.
- Not RIR/RPE-dependent. See `DATA_AND_LIMITATIONS.md`.
- Not a chart library. The chart in the drill-down (`BarLineChart`) is a
  presentation of `CanonicalExerciseSession[]`, not part of the decision
  logic.

## Verification

`scripts/verify-progress-engine.cjs` — 72 assertions against the real
un-mocked modules (sucrase, no live DB), covering `classifyLoadStructure`,
`buildCanonicalSessions`, `evaluatePair`, `buildNextTargets`, the trend
functions, event detection, five full worked examples, and
`RULE_CATALOG` completeness. Run: `node scripts/verify-progress-engine.cjs`.

## Change history

See `CHANGELOG.md`. `ALGORITHM_VERSION` (in `policies.ts`) is stamped on
every `ExerciseProgressResult` — bump it whenever decision semantics change,
and update `CHANGELOG.md` in the same change.
