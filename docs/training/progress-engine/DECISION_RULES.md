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
| `requiredTopRangeConfirmations` | 1 | product_rule | Reserved for a future stricter policy; v1 fires `READY_TO_INCREASE` the first time every set reaches the top of range |
| `plateau.graceSessions` | 3 | product_rule | Sessions after a load change before plateau logic can fire again |
| `plateau.minSessions` | 5 | product_rule | Sessions needed (past grace) before a flat read becomes `POSSIBLE_PLATEAU` rather than `BUILDING_BASELINE` |
| `plateau.residualNoiseFloor` | 1.0 (RMS reps) | product_rule | Above this, a series reads as `STABLE_VARIATION` regardless of slope |
| `plateau.accumulationSlopeFloor` | 0.3 (reps/session) | product_rule | Minimum slope to call real positive progress |
| `plateau.declineSlopeFloor` | 0.3 (reps/session) | product_rule | Minimum negative slope to call `DECLINING` |
| `decline.absoluteFloor` | 3 reps | product_rule | Decline-detection floor — never applied to a positive read |
| `decline.percentFloor` | 0.08 | product_rule | Decline-detection floor, proportional |
| `loadIncrementKg.{barbell,dumbbell,machine}` | 2.5 / 2 / 2.25 | product_rule | Our own equipment-class defaults, explicitly labeled as such wherever shown — never presented as a universal fact |

None of these are scientific findings. The one genuinely evidence-backed
input to this engine is the ≤12-rep eligibility ceiling on Epley e1RM
(`EST_1RM_MAX_REPS`, `progressAggregate.ts`), inherited unchanged from the
pre-existing Personal Records feature.

## Decision table

| Situation | `currentAction` |
|---|---|
| Load increased, every evaluated set at/above the minimum, at least one below the top | `BUILD_AT_CURRENT_LOAD` |
| Load increased, every evaluated set at/above the top | `READY_TO_INCREASE` |
| Load increased, at least one set below the minimum | `CONFIRM_BEFORE_INCREASING` |
| Same load, clean rep increase, not yet at the top | `BUILD_AT_CURRENT_LOAD` |
| Same load, clean rep increase, now at the top | `READY_TO_INCREASE` |
| A forward-motion read compromised by a `dataQualityFlags` entry | `CONFIRM_AT_CURRENT_LOAD` |
| Raw load decrease, external-load metric | `REVIEW_LOAD_REDUCTION` (never "deload") |
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
