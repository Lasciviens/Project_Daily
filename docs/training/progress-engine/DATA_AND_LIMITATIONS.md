# Data sources and known limitations

## RPE/RIR — deliberately not a dependency

`hevy_sets.rpe` exists as a column but is confirmed (per `CLAUDE.md`'s own
live-data check) to be 100% null in this app's real data. The engine:

- Never reads `rpe` anywhere in `progress-engine/`.
- Never caps, lowers, or otherwise changes `evidence.recommendation` based
  on its presence or absence.
- Never displays an "effort not tracked" caveat.

If RPE is logged in the future, it may only ever appear as optional,
clearly-separate context — never feeding a decision or an evidence level.

## `PROGRAM_CHANGED` — reserved, not implemented

`DataQualityFlag` includes `PROGRAM_CHANGED` in its type, but the engine
**never emits it**. Detecting a real historical target-range change (e.g.
"this routine's rep range for this exercise used to be 6-10, now it's
8-12") requires point-in-time target snapshots — knowing what the target
*was* at the time of a past session, not just what it is now. This app
resolves an exercise's target *live* from the routine's current structure;
it does not version that resolution over time.

A set-count mismatch (fewer or more working sets logged than the routine
currently prescribes) is a genuinely different, checkable fact and is
correctly flagged as `MISSING_PRESCRIBED_SET` / `EXTRA_UNPRESCRIBED_SET` —
these are not conflated with a target-range change.

**If this is ever built:** the natural approach is to snapshot the resolved
`ExpectationRange` alongside each newly-evaluated session (a small,
additive cache), then compare the two sessions' own snapshots rather than
inferring from set counts. Not started.

## Muscle-group / routine / date-range filters — not yet built

`ExerciseDecisionTable.tsx` ships search, 5 tabs, evidence-level filter,
and a date-window filter. Muscle-group and specific-routine filters need
per-exercise muscle/routine metadata this component doesn't currently
receive from `useProgressData.ts`. Flagged as a real fast-follow, not
silently dropped.

## `exercise_target_overrides` — read-only override, no editor UI yet

`policies.ts::resolveExpectation` supports rung 2 (an explicit per-exercise
user override) via `UserOverrideLookup`, wired to the existing
`exercise_target_overrides` table (migration 084). No dedicated load-
increment or required-confirmation-count override exists yet — v1 resolves
those from equipment-class defaults / the smallest historically-observed
increment only (see `ALGORITHM.md`).

## Verified against this repo's own established conventions, not re-derived from scratch

- **Failure sets are real working sets.** Verified against two independent,
  already-shipped statements in this repo (`progressAggregate.ts`'s own
  comment and `CLAUDE.md`'s Training → Progress documentation), not a
  fresh guess and not a live Hevy API call (no such access in the
  authoring session).
- **`hevy_workouts.title` / `hevy_sets.index`** — verified against the
  actual migration DDL (`supabase/migrations/024_hevy.sql`, lines 111-123
  and 195-210): both are real, `NOT NULL` columns; `index` additionally
  carries a `UNIQUE(hevy_exercise_id, index)` constraint. Not verified
  against a live production row in this session (no live-data opt-in was
  given for this specific check) — the DDL guarantee is sufficient to add
  them to the select safely.

## No production QA against a live Supabase session

This repo's own `CLAUDE.md` documents this exact constraint recurring
across many prior sessions: no Supabase login is available in the
authoring sandbox. Verification in this round consisted of:

1. The full pure-function test suite (`scripts/verify-progress-engine.cjs`,
   72 assertions) against the real, un-mocked engine code.
2. `npx tsc --noEmit`, `npm run build`, and `eslint` on every touched file.
3. A temporary, local-only harness (not committed) that rendered the REAL
   `ProgressOverview`/`ExerciseDecisionTable` production components against
   realistic fixture data computed through the real engine functions, to
   confirm the actual shipped component code renders and behaves
   correctly end to end. Screenshots from that harness are in the PR
   description.

A real login-gated QA pass (clicking through with actual Hevy data) has
not been performed and should happen before this ships to production use.
