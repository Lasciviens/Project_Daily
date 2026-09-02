# Progress redesign — working tracker (TEMPORARY, delete after ship)

Not indexed in `docs/README.md` on purpose — this is a session-continuity scratch
file for one in-flight feature (Training → Progress decision engine), not a
durable reference. Delete this whole `docs/progress-redesign/` directory once
the feature ships and CLAUDE.md has been updated with the final architecture.

Written in English per the repo's English-only rule (CLAUDE.md → Coding Rules)
even though it's temporary — chat with the user is in Turkish, repo files are not.

Full narrative plan (Turkish, presented to and revised with the user across two
rounds) lives as a published artifact, not in the repo. This file is the
**authoritative, current** spec — where it disagrees with anything said earlier
in chat, this file wins, because it reflects the user's own corrections
(2026-09-02) plus a second independent review they ran and endorsed.

---

## Round 2 (2026-09-02, same day, from live user testing of the merged PR #411)

The user tried the shipped feature immediately and found the single most
important bug: with no current program selected, the engine fell back to
"count every logged exercise as current" — producing an unreliable verdict,
a 40-50-row table, and old/current programs mixing again, the exact thing
this feature was supposed to fix. Plus a real design gap: no visibility into
muscle growth OVER TIME (only a snapshot), and zero jargon tooltips anywhere
despite that being an explicit original requirement.

Fixed, same branch cycle, new PR (`claude/progress-v2-fixes`, #411 already
merged so this is fresh off `main`):
1. **The gating bug** — `useProgressData` now hard-stops with
   `needsCurrentProgram: true` and zero decisions when nothing is selected,
   instead of silently treating everything as current.
2. **3-state verdict** (`progressing`/`mixed`/`insufficient_data`) —
   collapsed from the original 4-state confirmed/likely/stable split, the
   user's explicit ask for one clear headline word.
3. **4 summary cards** on `ProgressOverview` — routine adherence, exercise
   progress, bodyweight direction, data confidence.
4. **Immediate actions capped at 5**, sorted by urgency (Increase/Plateau/
   Watch first); "Not enough data" exercises collapse into a closed section.
5. **Muscle dose rework**: "Routine expectation" now derived from the
   CURRENT PROGRAM'S OWN structure (one full pass through its routines), not
   a generic MEV/MAV landmark; a 6-week sparkline per muscle so growth is
   actually visible, not just a snapshot; `exclude_direct` renders as a
   plain statement, nothing else.
6. **`InfoBubble` everywhere** — extracted to `src/shared/components/`,
   used on every technical term across the whole feature.

See CLAUDE.md's Training → Progress section for the settled documentation of
all of the above — this section is a historical record of what changed and
why, not duplicated detail.

---

## Status at a glance

| Phase | Status |
|---|---|
| 1–2. Audit + sports-science/strength-coach consultation | ✅ Done |
| 3. Algorithm draft + safety-review pass | ✅ Done |
| 4. Plan presented (Turkish document) | ✅ Done |
| 5. User feedback round 1 (own + a second "ChatGPT" review) | ✅ Incorporated below |
| 6. Demo v1 (3 style options) | ✅ Done — user picked **Style C (Editorial Report)** |
| 7. Demo v2 (Style C only, richer — charts, drill-down pages, hover terms) | ✅ Done |
| 8. Fix the 2 confirmed pre-existing bugs | ✅ Done |
| 9. Migration: `current_program_routines` + `athlete_muscle_preferences` + `exercise_target_overrides` | ✅ Written (084), not yet applied by user |
| 10. API + hooks for the above | ✅ Done |
| 11. Settings UI (current-program picker + muscle-preferences sheet) | ⬜ Not started |
| 12. `progressDecisions.ts` + `progressCopy.ts` (revised model) | ✅ Done |
| 13. `scripts/verify-progress-decisions.cjs` | ✅ Done — 56/56 passing |
| 14. Production components (Overview/Table/DrillDown/MuscleMatrix) | ✅ Done |
| 15. Wire into `ProgressTab.tsx` + update `CLAUDE.md` | ✅ Done |

**Feature is code-complete on this branch.** Remaining before this file can be
deleted: user applies migration 084, exercises the feature live with their
own login (not possible in the authoring sandbox), and either approves it
as-is or requests changes. See "Not built yet" below for the one thing
deliberately deferred.

**Branch:** `claude/progress-decision-engine` (fresh off `main` after PR #410 merged).
**PR:** #411 (draft) — https://github.com/Lasciviens/Project_Daily/pull/411

### What actually exists right now (verified, not aspirational)

- `src/features/training/progressDecisions.ts` — the decision engine: `rpeToRir`,
  `filterToCurrentProgram`, `computeTrendConfidence`, `resolveExpectation`,
  `computeRpeEvidence`, `computeActionConfidence`, `computeExerciseDecision`,
  `computeProgramDecision`.
- `src/features/training/progressCopy.ts` — the copy formatter.
- `supabase/migrations/084_progress_decisions.sql` — the 3 new tables (not applied).
- `src/features/training/api/athleteProfileApi.ts` + `hooks/useAthleteProfile.ts`
  — full CRUD for all 3 new tables, pre-migration-safe.
- `src/features/training/types.athlete.ts` — the matching TS types.
- `hevyApi.ts::fetchTrainingHistory` now also selects `routine_id` and `rpe`;
  `ProgressSetRow` carries both as optional fields.
- Two pre-existing bugs fixed in place: `muscleMap.ts::bandForWeeklySets`
  (scale-mismatch) and `trainingInsights.ts::computeConsistencyFindings`
  (now reads `training_days_per_week` instead of a hardcoded bar).
- `scripts/verify-progress-decisions.cjs` — 56 assertions, all passing.
  All 5 pre-existing verify scripts (268 assertions) still pass; `tsc` and
  `npm run build` both clean as of the last commit on this branch.

### Not built yet — do not assume these exist

- **A real per-exercise chart with a true time-scaled axis + routine-change
  markers** (the demo showed this; production `ExerciseDecisionTable`'s
  expandable row is text/evidence only, no chart yet — `ExerciseProgressChart.tsx`
  still uses a categorical axis with even spacing regardless of real gaps).
  This is the one item from the original plan's chart spec (§15) not carried
  into production in this pass — a reasonable next increment, not silently
  dropped.
- No dedicated exercise-target-override editor UI (the `exercise_target_overrides`
  table + API/hooks exist; nothing in the settings UI writes to it yet — an
  athlete can't yet set rung-2 of the expectation order from the app itself).
- Live browser verification wasn't possible in the authoring sandbox (no
  Supabase login available) — verified via `tsc`, `npm run build`, and all
  6 verify scripts (324 assertions) instead. The user should exercise this
  for real once migration 084 is applied.

---

## What changed from the first draft (user's corrections + endorsed second review)

### 1. RPE/RIR is now OPTIONAL evidence, never a mandatory gate

Original draft permanently capped every "Increase weight" call at Medium
confidence because RPE was 100% null. **User's explicit correction:** RPE must
not be required. The user is about to start logging it. When present, use it
as *bonus corroborating evidence*, not a blocker when absent.

Hevy's own RPE→RIR mapping (user-provided, use exactly this):
`RPE 8 ≈ 2 RIR`, `RPE 9 ≈ 1 RIR`, `RPE 10 ≈ 0 RIR`.

### 2. Two separate confidence dimensions, not one

- **Trend confidence** — "is this exercise really progressing/plateauing?"
  Driven purely by comparable-session count, week span, effect size vs. noise
  band, rep-range consistency. **Never touched by RPE availability.** Can be
  High even with zero RPE data.
- **Action confidence** — "how confident are we in the specific recommended
  action?" Starts from Trend confidence, then adjusted by effort data *when
  it exists*:
  - Qualifying sets' average RIR ≥ 2 (RPE ≤ 8) → Action confidence can reach
    **High** (trend agrees + effort confirms headroom existed).
  - Average RIR = 1 (RPE 9) → Action confidence stays at whatever Trend says,
    capped at **Medium**.
  - Average RIR = 0 (RPE 10, truly maximal) → Action confidence capped at
    **Medium**, with an explicit note that the qualifying set was maximal —
    worth confirming technique held up.
  - RPE absent entirely for the qualifying window → Action confidence capped
    at **Medium**, and the card shows, verbatim, next to the action only:
    > "Effort was not tracked, so confirm that your technique remained
    > controlled before increasing the weight."
    (User gave this exact English sentence — use it verbatim, don't
    paraphrase. This is production UI copy, so it stays in English per the
    repo's English-only rule regardless of the rest of this doc's audience.)

Example composed sentence (user's own example, keep this shape):
> High confidence that performance is improving.
> Medium confidence in increasing weight because effort data is unavailable.

### 3. Increase-weight criteria — historical reps NEVER define the target

Original draft's rung 2 ("the athlete's own observed rep range over the last
4–6 sessions") is **removed**. Second review's point stands: if the athlete
has been chronically under-performing at 5–7 reps, treating that as "the
range" and recommending a weight increase at rep 7 entrenches the bad
pattern — a self-reinforcing loop.

**Corrected expectation/target source order:**
1. The routine's own recorded target (`hevy_routine_sets.rep_range_start/end`
   for that exercise, resolved through the *explicit* current program — see
   §4).
2. The user's own explicitly-configured override for that exercise (NEW —
   see the `exercise_target_overrides` table below). This is a deliberate,
   user-set number, never inferred.
3. An exercise-TYPE-appropriate generic default, **always rendered with an
   explicit "Default (no target saved)" label** — never silently presented
   as if it were the athlete's real program.
4. If somehow none of the above resolves → render **"Target not configured"**
   as an actual visible state, not a silent guess.

Historical reps are still used — but ONLY to measure current performance and
direction (the trend), never to define what "success" means for that
exercise.

### 4. "Current program" is now EXPLICIT, never inferred alone

Original draft: "routine_id seen on a workout in the last 21–28 days." User +
second review reject this outright — a vacation, a skipped week, an old
routine trained recently by coincidence, or a multi-routine split (Upper +
Lower as two separate `hevy_routines` rows) all break a pure recency
heuristic.

**Corrected design:** a new relation table, `current_program_routines`
(user_id, routine_id) — literally the set of routines the user has explicitly
marked as part of their current program. Supports multiple concurrent
routines (a split). The 21–28-day recency heuristic still has ONE legitimate
job: pre-checking a sensible default in the picker UI the very first time a
user opens it (empty table) — but the user must explicitly confirm/save it.
The decision engine never runs off silent inference alone.

### 5. Muscle preferences — renamed, and re-modeled as three real states

Original draft: `athlete_muscle_priorities(muscle_slug, priority CHECK IN
('priority','deprioritized'))`. User's correction: **"no direct ab training"
is not the same claim as "abs is deprioritized."** A muscle can be a genuine
training priority, explicitly excluded from *direct* work, or neither (the
default/unmarked state for every other muscle).

**Corrected table:** `athlete_muscle_preferences(id, user_id, muscle_slug,
preference CHECK IN ('priority', 'exclude_direct'), created_at, updated_at)`.

- `priority` → elevated urgency copy when below MEV (matches the original
  design).
- `exclude_direct` → suppresses ONLY the "you have no direct work for this
  muscle" warning. **It must never zero out or discount the muscle's real
  credited sets from indirect/secondary exercise contribution** — those
  still count normally in every aggregate. The muscle's true dose stays
  visible; only the nag is suppressed.
- No row for a muscle = normal, no special treatment either way.

**Real UI requirement (was missing from the first draft — API/hook alone is
not enough):** these preferences must be visible, editable, and deletable
from a settings screen, matching the existing `LimitationsList.tsx` pattern
exactly (every row visible even if inactive, one tap to reactivate, delete
is a separate confirmed action).

### 6. `ExerciseDecision.status` loses `review_workload` — it moves to a new program-level type

Second review's correct catch: "review workload" requires signals from ≥2
*different* exercises plus a corroborating recovery/volume signal — it is
structurally a program-level judgment, not a single exercise's own status.
Keeping it in `ExerciseDecision.status` was a category error.

**Corrected split:**
```ts
// Per exercise — an individual movement's own read.
type ExerciseStatus = 'increase' | 'keep' | 'watch' | 'plateau' | 'insufficient_data'

// Per program (one per page load) — a judgment about the training BLOCK as a whole.
interface ProgramDecision {
  progressVerdict: 'confirmed' | 'likely' | 'stable' | 'insufficient_data'
  workload: 'continue' | 'review_workload' | 'ease_off'
  evidence: {
    affectedExerciseIds: string[]   // the ≥2 exercises whose decline triggered this, if any
    corroboratingSignal: string | null  // which second signal agreed (volume/sleep/limitation)
  }
}
```
The affected exercises are shown as evidence FOR the program-level card —
they keep their own honest exercise-level status (e.g. `plateau`), they are
never individually mislabeled `review_workload`.

### 7. Muscle matrix shows ALL trained muscles, not just priority-filtered ones

Original draft's `MuscleDoseSummary` defaulted to showing only
priority+limited muscles, with the full grid demoted behind a toggle.
Second review's correct catch: this can hide a real, serious deficiency in a
non-priority muscle (e.g. quads or back) simply because it isn't flagged as
a personal priority.

**Corrected design:** show every muscle actually trained under the current
program by default, in one grid. Priority muscles get a visual highlight
(border/star), `exclude_direct` muscles are shown but relabeled "Excluded by
preference" instead of a warning pill — never removed from the grid. Every
cell always shows expected (landmark-scaled) vs. actual sets, regardless of
priority state.

---

## New schema (proposed migration, not yet applied — file will exist in the branch, user applies manually per repo convention)

```sql
-- Explicit current-program membership (NOT an inferred recency window).
CREATE TABLE public.current_program_routines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id   text NOT NULL,  -- hevy_routines.id, no FK (same no-FK convention hevy_routine_exercises already uses for exercise_template_id)
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, routine_id)
);

-- Muscle-level training preferences (priority / excluded-from-direct-work).
CREATE TABLE public.athlete_muscle_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  muscle_slug  text NOT NULL,
  preference   text NOT NULL CHECK (preference IN ('priority', 'exclude_direct')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, muscle_slug)
);

-- Per-exercise user-set target override (rung 2 of the expectation source order —
-- deliberately separate from Hevy's own synced routine data, which this app never
-- writes to directly).
CREATE TABLE public.exercise_target_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_template_id  text NOT NULL REFERENCES public.hevy_exercise_templates(id) ON DELETE CASCADE,
  rep_range_start        integer NOT NULL,
  rep_range_end          integer NOT NULL,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_template_id)
);
```
All three: RLS owner-only policy, `trg_audit`, `updated_at` trigger where the
row is ever patched in place — mirrors `070_athlete_profile.sql`'s own
documented convention exactly. Migration number: next free one after `083`
(check `supabase/migrations/` at write time — do not hardcode a number here
that might already be taken by other work landed in the meantime).

---

## Demo

Style C only now (user picked it). Published artifact, updated in place —
see chat history for the live URL. v2 adds: hash-based sub-pages (Overview /
Exercise detail / Current-program picker / Muscle preferences settings / Full
muscle matrix), dotted-underline hover terms (not click-only), real SVG
charts (exercise trend with true time gaps + routine-change marker, adherence
bar chart, muscle sparklines for ALL trained muscles), and the corrected
model (trend/action confidence shown separately, RPE bonus-evidence example,
program-level Continue/Review workload/Ease off card distinct from exercise
cards, "Target not configured" example, exclude_direct shown-not-hidden
example).

---

## Next up (in order)

1. Fix the 2 confirmed pre-existing bugs (small, isolated, no schema dependency).
2. Write the migration file (does not touch production until the user applies it).
3. `athleteProfileApi.ts` + `trainingProgramApi.ts` extensions, matching hooks.
4. Settings UI.
5. `progressDecisions.ts`/`progressCopy.ts` per the corrected model above.
6. `scripts/verify-progress-decisions.cjs`.
7. Production components, then wire into `ProgressTab.tsx`.
8. Update `CLAUDE.md`'s Training section with the final architecture; delete this file.
