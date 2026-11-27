# Decision rules and evidence tiers

Every non-obvious threshold below is tagged with exactly one evidence
class, per `ruleCatalog.ts`:

- **science** — directly supported by cited research.
- **product_rule** — a deterministic, useful, but non-validated heuristic.
- **program_policy** — comes from the athlete's own routine/override/config.

## Configurable constants (`policies.ts::DEFAULT_POLICY`)

| Constant | Default | Evidence class | Note |
|---|---|---|---|
| `recentWindowSessions` | 8 | product_rule | The recent-trend window; always disclosed to the user as "based on the last N comparable sessions" |
| `requiredTopRangeConfirmations` | 2 | product_rule (S3/S10, low) | Sessions in a row at the top of the range, at one load, before `READY_TO_INCREASE`; fewer is `REPEAT_AT_TOP`. A session worse than the last never counts (since 3.0.0) |
| `plateau.graceSessions` | 3 | product_rule | Sessions after a load change before plateau logic can fire again |
| `plateau.minSessions` | 4 | science (S13, moderate idea / low numbers) | Sessions needed (past grace) before a flat read becomes `POSSIBLE_PLATEAU` rather than `BUILDING_BASELINE` |
| `plateau.minDays` | 21 | science (S13) | …and days between the first and last of them (since 3.0.0) |
| `plateau.residualNoiseFloor` | 1.0 (RMS reps) | product_rule | Above this, a series reads as `STABLE_VARIATION` regardless of slope |
| `plateau.accumulationSlopeFloor` | 0.3 (reps/session) | product_rule | Minimum slope to call real positive progress |
| `plateau.declineSlopeFloor` | 0.3 (reps/session) | product_rule | Minimum negative slope to call `DECLINING` |
| `decline.absoluteFloor` | 3 reps | product_rule | Decline-detection floor — never applied to a positive read |
| `decline.percentFloor` | 0.08 | product_rule | Decline-detection floor, proportional |
| `loadIncrementKg.{barbell,dumbbell,machine}` | 2.5 / 2 / 2.5 | product_rule | The equipment's smallest step — our own defaults, explicitly labeled as such wherever shown |
| `loadStep.targetPercent` | upper/small 2.5 · large lower 5 | science (S4, moderate for 2–10 %, low for the bands) | The step as a % of the load, rounded to whole smallest steps (at least one) |
| `loadStep.maxPercent` | 10 | product_rule (S5, low) | A smallest step above this is `ALMOST_READY`: reps first or jump |
| `loadStep.percentPerExtraRep` / `repsFirstExtraCap` | 2.5 / 2 | product_rule (S5; cap from the owner's brief) | Reps first aims for the top + ceil(step % ÷ 2.5), at most +2 |
| `loadStep.percentPerRepLost` | 2–3 % per rep | product_rule (S5 / §1.3, low) | The "expect about N reps there" estimate after a jump |

These cite `docs/training/science.md`; low confidence means expert practice,
not a tested optimum. The e1RM shown anywhere is Epley from sets of ≤ 10
reps (`EST_1RM_MAX_REPS`, S15).

## Decision table

| Situation | `currentAction` |
|---|---|
| Load increased, not every set at the top (the first session at a heavier load) | `NEW_WEIGHT` ("New weight") |
| Every set at the top, but not 2 sessions in a row at this load, or worse than last time | `REPEAT_AT_TOP` ("Repeat") |
| Every set at the top 2 sessions in a row at one load, step ≤ 10 % | `READY_TO_INCREASE` ("Add weight"; "Less assist" when assisted) |
| …the smallest step is > 10 % and the sets are short of top + extra | `ALMOST_READY` ("Almost") |
| Same load, clean rep increase, not yet at the top | `BUILD_AT_CURRENT_LOAD` ("Add reps") |
| The last 2 sessions at a jumped-to load both below the minimum, the second no better | `STEP_BACK` ("Step back"), target at the previous load |
| A forward-motion read compromised by a `dataQualityFlags` entry | `CONFIRM_AT_CURRENT_LOAD` ("Check sets") |
| Load decrease right after a jump | read at the lower load (`STEPPED_BACK` reason) |
| Raw load decrease otherwise, external-load metric | `REVIEW_LOAD_REDUCTION` ("Lighter", never "deload"), with a target |
| Raw load decrease is the POSITIVE direction (assisted-weight) | routed through the forward-motion branches above |
| Mixed-load session | `HOLD_STEADY` (evaluationScope/rangeCompliance both `NOT_EVALUATED`) |
| Long-window plateau, no fresh improvement this pair | `WATCH_FOR_PLATEAU` (overrides the flat two-point read) |
| Long-window decline, no fresh improvement this pair | `WATCH_FOR_REGRESSION` |
| Fewer than 2 comparable sessions | `INSUFFICIENT_DATA` |

## Evidence levels

Exactly the three user-approved labels, never renamed:

- **Limited evidence**
- **Moderate evidence**
- **Strong evidence**

`evidence.progress` (supports the recent-trend read): gated on sample size
and time span — `strong` at ≥6 sessions/≥3 weeks, `moderate` at ≥4/≥2,
`limited` otherwise. **Never touched by RPE/RIR, present or absent.**

`evidence.recommendation` (supports the current action specifically):
`limited` whenever any `dataQualityFlags` entry is present, otherwise
`strong` when `evaluationScope === ALL_PRESCRIBED_WORKING_SETS`, else
`moderate`. **Also never touched by RPE/RIR** — see `DATA_AND_LIMITATIONS.md`.

## Deterministic events

| Code | Emphasis | Trigger |
|---|---|---|
| `LOAD_PR` | primary | The representative load beats the all-time extreme (direction-aware — a decrease for assisted-weight) |
| `TOTAL_REPS_PR_AT_LOAD` | primary | Highest comparable-set-count total ever at this exact load |
| `TARGET_COMPLETED` | primary | Every comparable working set reached the top of range this session |
| `ESTIMATED_STRENGTH_PR` | secondary | A new high in Epley e1RM — **always** secondary, never the headline, but never suppressed either |

`emphasis` is the structured signal the UI uses for visual priority — the
data model always includes every event that fired; only rendering
prominence is `emphasis`-driven.
