# Algorithm

## Data lineage

```
hevy_workouts / hevy_workout_exercises / hevy_sets  (Supabase, synced from Hevy)
      │  fetchTrainingHistory()  (src/features/training/api/hevyApi.ts)
      ▼
ProgressSetRow[]   (progressAggregate.ts) — now includes workout_title (hevy_workouts.title)
      │             and set_index (hevy_sets.index), both real NOT NULL columns.
      ▼
buildCanonicalSessions(sets, templateId)   (normalize.ts)
      ▼
CanonicalExerciseSession[]  — complete ordered set vector preserved, warmups
      │                       excluded, dropset/failure tagged, grouped by
      │                       workout_id (never date alone)
      ▼
evaluateExerciseProgress({ sessions, expectation, metricKind }, policy)
      ▼
ExerciseProgressResult
```

## Canonical session identity

A session = one `workout_id`. Warmup sets are excluded before a
`CanonicalExerciseSession` is even built. `comparableWorkingSets` further
excludes `dropset` (a dropset structurally follows a heavier set and is
never a "prescribed working set" for range-compliance/rep-delta purposes)
but **includes `failure`** — a failure-tagged set is a completed working
set with an annotation, not a discarded one (matches this repo's own
pre-existing, already-shipped convention in `progressAggregate.ts` and
`CLAUDE.md`: "a failure set is a real top effort that must stay eligible").

## Session load structure

```ts
type SessionLoadStructure = 'uniform_working_load' | 'top_set_and_backoff' | 'mixed_load'
```

- **uniform_working_load** — every comparable set shares one load.
- **top_set_and_backoff** — the first set is the heaviest, every remaining
  set shares one single lower load. A 2-set heavier-then-lighter session is
  *always* this shape by definition (there is only one possible "rest"
  value) — `mixed_load` genuinely needs ≥3 sets with real internal
  inconsistency (e.g. 100 → 90 → 95 kg — a real increase mid-session).
- **mixed_load** — anything else. Uniform-load double-progression rules are
  never applied to it: `observedTransition`/`rangeCompliance` become
  `NOT_EVALUATED`/`NOT_EVALUATED`/`'mixed_load'` gets flagged in
  `dataQualityFlags`, and `currentAction` falls to `HOLD_STEADY`. All-history
  PR detection still runs off the session's own single heaviest set — a
  factual PR doesn't require a clean structure to be true.

## The per-pair read (`comparability.ts`)

Computed between the last two comparable sessions. Five independent
facets, never collapsed into one status:

| Facet | Values |
|---|---|
| `observedTransition` | `NO_COMPARISON` / `LOAD_INCREASED` / `LOAD_DECREASED` / `LOAD_UNCHANGED` — a pure factual read of the representative load, unaffected by data-quality issues |
| `repDelta` | `REP_INCREASE` / `REP_DECLINE` / `REP_NO_CHANGE` / `NOT_APPLICABLE` — only meaningful within `LOAD_UNCHANGED` and equal comparable-set counts |
| `rangeCompliance` | `ALL_SETS_AT_TOP` / `ALL_SETS_AT_OR_ABOVE_MIN` / `BELOW_MINIMUM` / `NOT_EVALUATED` |
| `evaluationScope` | `ALL_PRESCRIBED_WORKING_SETS` / `LOGGED_SETS_ONLY` / `TOP_SET_ONLY` / `NOT_EVALUATED` — what `rangeCompliance` actually inspected; copy never says "every prescribed set" outside `ALL_PRESCRIBED_WORKING_SETS` |
| `dataQualityFlags` | `MISSING_PRESCRIBED_SET` / `EXTRA_UNPRESCRIBED_SET` / `MIXED_LOAD_SESSION` / `PROGRAM_CHANGED` (reserved, never emitted in v1 — see `DATA_AND_LIMITATIONS.md`) |

**Rep delta rule** (the "clean increase" test): any positive change in total
comparable reps counts, with one guard — no individual set may have
decreased. **No magnitude floor on the positive side.** A separate,
configurable threshold (`meaningfulDeclineReps`, `trend.ts`) exists
**only** for decline detection:

```ts
meaningfulDeclineReps(prevTotal) = max(policy.decline.absoluteFloor, ceil(prevTotal * policy.decline.percentFloor))
// defaults: absoluteFloor = 3, percentFloor = 0.08
```

**Current action derivation** (`deriveCurrentAction`): a raw load decrease
on an external-load metric is always `REVIEW_LOAD_REDUCTION` (neutral,
intent unknown — never "deload" language). Forward motion (a positive load
change, direction-aware via `isPositiveLoadChange`, or a clean rep
increase) maps to `READY_TO_INCREASE` / `CONFIRM_BEFORE_INCREASING` /
`BUILD_AT_CURRENT_LOAD` depending on `rangeCompliance`; a data-quality flag
downgrades an otherwise-positive read to `CONFIRM_AT_CURRENT_LOAD` rather
than blocking it outright.

**Precedence rule** (`evaluate.ts`): if the longer-window `currentLoadProgress`
says `POSSIBLE_PLATEAU` or `DECLINING`, `currentAction` is overridden to
`WATCH_FOR_PLATEAU`/`WATCH_FOR_REGRESSION` — **unless** this exact pair shows
a fresh, real improvement (`LOAD_INCREASED` with compliant range, or a clean
`REP_INCREASE`), in which case the two-point read wins. A genuine
improvement this session is never buried under a stale long-window read.

## Trend — two structurally separate axes (`trend.ts`)

```
representative point series = one {date, loadStructure, weightKg, total} per session
      │
      ├── buildLoadCycles() → maximal runs sharing one representative load
      │
      ├── computeRecentProgressTrend(points, policy)
      │     window = points.slice(-policy.recentWindowSessions)  (default 8)
      │     counts load-cycle advances + clean within-cycle rep increases as
      │     positive signals; load-cycle retreats + meaningful declines as
      │     negative. -> INSUFFICIENT_HISTORY / PROGRESSING / FLAT_NORMAL_VARIATION / REGRESSION_RISK
      │     ALWAYS reports the real N used — the UI must disclose it.
      │
      └── computeCurrentLoadProgress(currentCycle.points, policy)
            scoped ONLY to the current stable-load segment; mixed_load
            points excluded before regression ever runs (never a NaN).
            -> linearFit() over session index (see below)
            -> INSUFFICIENT_HISTORY (<3) / TOO_EARLY_TO_JUDGE (flat, within
               grace) / BUILDING_BASELINE (flat, past grace, short of the
               plateau floor) / ACCUMULATING (real positive slope) /
               STABLE_VARIATION (noisy) / POSSIBLE_PLATEAU (flat, enough
               sessions) / DECLINING (real negative slope)
```

All-history PR/achievement detection (`events.ts`) is **never** windowed —
an earlier successful load cycle keeps its `LOAD_PR`/`TOTAL_REPS_PR_AT_LOAD`
forever, even once it falls outside the recent window.

### `linearFit` — directional consistency, not raw spread

```ts
function linearFit(y) {
  // least-squares slope of y over session index 0..n-1
  // residualSpread = RMS of (actual - fitted) across all points
}
```

A perfectly monotonic climb (20, 21, 22, 23, 24) has `residualSpread ≈ 0`
even though its raw max−min spread is 4 — it reads as `ACCUMULATING`, never
"high variation". A genuinely noisy flat series (20, 24, 19, 23, 20) has a
real residual and correctly reads as `STABLE_VARIATION`. This replaces the
retired `repRangeVariedSignificantly` (which operated on a single top-set
rep count and needed a bolt-on "explained by a weight change" patch to
avoid penalizing a deliberate load increase) — the new design makes that
patch unnecessary by construction, since a load change starts a new cycle
and is never compared across.

## Next Targets (`targets.ts`)

```ts
minimumSetReps    = latest session's own reps, position-for-position — the real floor
minimumTotalReps  = sum(minimumSetReps) + 1
```

A candidate only counts as clean progress when **every position** meets its
floor **and** the total meets its floor. `8/6/8` (total 22) fails against a
floor of `[8,7,6]` (position 2 regressed) even though its total matches;
`8/7/7` and `9/7/6` both pass.

## Metric-strategy dispatch (`policies.ts`)

Reuses `metricKindForExerciseType` (`progressAggregate.ts`) unchanged. The
one real inversion — assisted-bodyweight, where less assistance weight is
the positive direction — is centralized in `isPositiveLoadChange`, never
hand-coded per branch. `reps`-only and duration-without-load types have no
load-cycle axis; progression is judged purely on the reps/duration series
(the engine's session-grouping and rep-delta machinery is metric-kind
agnostic beyond that one inversion).
