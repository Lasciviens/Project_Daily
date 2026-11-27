// Progress engine — Next Target generation. Action-aware and always concrete:
// every target is a set-by-set plan where each set keeps its OWN load (a
// top-set+backoff session keeps its backoff load on the backoff sets).
//
// Floor + stretch (S12, S14, S16; owner, 27.11.2026: "this page forces me
// always to go up in weight asap... It does not feel right"): matching last
// time is on track, one more rep anywhere is progress — "Repeat 10/10/9 = good
// · +1 rep anywhere = progress". The set targets ARE that floor; nothing asks
// for more than last time as a minimum.
//
// - READY_TO_INCREASE (2 sessions in a row at the top, S3): the next load is a
//   % step (S4) rounded to the equipment's smallest step (resolveLoadStep). A
//   top-set+backoff session raises only its top set. A bodyweight movement
//   adds weight (a belt or vest) or a harder variation.
// - ALMOST_READY (the smallest step is over 10 %, S5): reps first (the top of
//   the range + up to 2 on every set) or jump now — both are progress.
// - STEP_BACK (S6): the previous load, with the sets last done there.
// - Every other action keeps the load (floor + stretch).
// - No numeric target when the latest session can't carry one: mixed loads,
//   a set count that doesn't match the prescription, or missing values.
//   `nextTargetBlocker` says which, so the copy explains the ACTUAL cause.

import type {
  CanonicalExerciseSession, CanonicalSet, ExpectationRange, NextTargetBlocker, NextTargetResult, ProgressMetricKind,
  CurrentAction, ExerciseProgressionPolicy, SetTarget, TargetQuantityUnit, LiftClass,
} from './types'
import { bestComparableSet } from './normalize'
import { isWeightBasedMetric, quantityFor } from './metricStrategy'
import { resolveLoadIncrementKg, resolveLoadStep, repsFirstExtra, expectedRepsAfterStep } from './policies'
import { formatKg, formatQuantity, formatSetTargets, quantityUnitFor } from './format'

/** Actions whose plan is "keep the load": floor + stretch. */
const STAY_AT_LOAD_ACTIONS: ReadonlySet<CurrentAction> = new Set<CurrentAction>([
  'BUILD_AT_CURRENT_LOAD', 'CONFIRM_AT_CURRENT_LOAD', 'HOLD_STEADY', 'REPEAT_AT_TOP', 'NEW_WEIGHT',
  'REVIEW_LOAD_REDUCTION', 'WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'INSUFFICIENT_DATA', 'ALMOST_READY',
])

/** The stretch beyond the floor: one rep, or five seconds on a timed hold.
 *  Distance has no honest fixed step (more metres, or the same metres
 *  faster?), so it is match-or-beat only. A product rule, not a finding. */
export const QUANTITY_STEP: Record<TargetQuantityUnit, number> = { reps: 1, seconds: 5, metres: 0 }

function inOrder(sets: readonly CanonicalSet[]): CanonicalSet[] {
  return [...sets].sort((a, b) => a.order - b.order)
}

/** Why no numeric target can be issued for this session, or null when one
 *  can. */
export function nextTargetBlocker(
  latest: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
  currentAction: CurrentAction,
): NextTargetBlocker | null {
  const sets = latest.comparableWorkingSets
  if (sets.length === 0) return 'no_sets'
  if (latest.loadStructure === 'mixed_load') return 'mixed_load'
  if (sets.length !== expectation.targetSets) return 'set_count_mismatch'
  if (sets.some(s => quantityFor(s, metricKind) == null)) return 'missing_values'
  if (currentAction !== 'READY_TO_INCREASE' && currentAction !== 'STEP_BACK' && !STAY_AT_LOAD_ACTIONS.has(currentAction)) return 'action'
  return null
}

/** The reps a session's range check read: every comparable set, or only the
 *  top set of a top-set + backoff session. */
export function evaluatedReps(session: CanonicalExerciseSession): number[] {
  const sets = inOrder(session.comparableWorkingSets)
  const scoped = session.loadStructure === 'top_set_and_backoff' ? sets.slice(0, 1) : sets
  return scoped.map(s => s.reps ?? 0)
}

export type StayPlanCode = 'MATCH_OR_PROGRESS' | 'RECOVER_PREVIOUS' | 'REPEAT_TO_CONFIRM' | 'MATCH_OR_BEAT'

export interface StayPlan {
  code: StayPlanCode
  /** The floor: last time's sets. Matching them is on track (S16). */
  targets: SetTarget[]
  floor: number[]
  /** The previous session's sets when this one dropped below them at the same
   *  loads — getting back there is the progress. */
  previous: number[] | null
}

/** The "keep the load" plan for one session (sets must all carry the
 *  metric's quantity — see nextTargetBlocker). */
export function planStayTargets(
  latestSets: readonly CanonicalSet[],
  previousSets: readonly CanonicalSet[] | null,
  metricKind: ProgressMetricKind,
  expectation: ExpectationRange,
): StayPlan {
  const latest = inOrder(latestSets)
  const floor = latest.map(s => quantityFor(s, metricKind) as number)
  const unit = quantityUnitFor(metricKind)
  const targets = latest.map((s, i) => ({ weightKg: s.weightKg, quantity: floor[i] }))

  const previous = previousSets ? inOrder(previousSets) : null
  const prevQ = previous?.map(s => quantityFor(s, metricKind)) ?? null
  const sameShape = previous != null && prevQ != null
    && previous.length === latest.length
    && previous.every((s, i) => s.weightKg === latest[i].weightKg)
    && prevQ.every(q => q != null)
  if (sameShape && (prevQ as number[]).some((q, i) => q > floor[i])) {
    return { code: 'RECOVER_PREVIOUS', targets, floor, previous: prevQ as number[] }
  }
  if (QUANTITY_STEP[unit] === 0) return { code: 'MATCH_OR_BEAT', targets, floor, previous: null }
  if (unit === 'reps' && expectation.repMax != null && floor.every(q => q >= (expectation.repMax as number))) {
    return { code: 'REPEAT_TO_CONFIRM', targets, floor, previous: null }
  }
  return { code: 'MATCH_OR_PROGRESS', targets, floor, previous: null }
}

function stretchPhrase(unit: TargetQuantityUnit): string {
  return unit === 'seconds' ? `+${QUANTITY_STEP.seconds} s on any set = progress` : '+1 rep anywhere = progress'
}

function progressionRequirement(
  latest: CanonicalExerciseSession, expectation: ExpectationRange, metricKind: ProgressMetricKind, loadKg: number | null, setCount: number,
  policy: ExerciseProgressionPolicy,
): NextTargetResult['progressionRequirement'] {
  const { repMin, repMax } = expectation
  const at = loadKg != null ? ` at ${metricKind === 'assistedWeight' ? `${formatKg(loadKg)} assist` : formatKg(loadKg)}` : ''
  const targetSetReps = repMax != null ? Array(setCount).fill(repMax) : null
  const times = policy.requiredTopRangeConfirmations
  const inARow = times > 1 ? ` in ${times} sessions in a row` : ''
  let headline: string
  if (repMax == null || quantityUnitFor(metricKind) !== 'reps') {
    headline = 'No rep range is saved for this exercise, so there is no fixed point to add load — keep matching or beating last time. Add a rep range to the routine to get one.'
  } else if (!isWeightBasedMetric(metricKind)) {
    headline = `Once every set reaches ${repMax} reps${inARow}, add weight (a belt or vest) or move to a harder variation.`
  } else if (latest.loadStructure === 'top_set_and_backoff') {
    headline = `Add weight to the top set once it reaches ${repMax} reps${at}${inARow}${repMin != null ? `, with every backoff set at ${repMin}+` : ''}.`
  } else if (repMin === repMax) {
    headline = `Add weight once you complete ${setCount} × ${repMax}${at}${inARow}.`
  } else {
    headline = `Add weight once every set reaches ${repMax} reps${at}${inARow}.`
  }
  return { headline, loadKg, targetSetReps, explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE' }
}

/** What the engine knows beyond the session itself. */
export interface TargetContext {
  liftClass?: LiftClass
  /** STEP_BACK: the last session at the previous load. */
  stepBackTo?: CanonicalExerciseSession | null
  /** REPEAT_AT_TOP: how many sessions in a row are at the top, of how many. */
  confirmations?: { count: number; required: number } | null
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function buildNextTargets(
  latest: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
  currentAction: CurrentAction,
  policy: ExerciseProgressionPolicy,
  explicitIncrementKg: number | null,
  equipmentClass: 'barbell' | 'dumbbell' | 'machine' | null,
  observedIncrements: readonly number[],
  previous: CanonicalExerciseSession | null = null,
  context: TargetContext = {},
): NextTargetResult | null {
  if (nextTargetBlocker(latest, expectation, metricKind, currentAction) != null) return null
  const sets = inOrder(latest.comparableWorkingSets)
  const unit = quantityUnitFor(metricKind)
  const weightBased = isWeightBasedMetric(metricKind)
  const load = weightBased ? (bestComparableSet(latest, metricKind)?.weightKg ?? null) : null
  const isBackoff = latest.loadStructure === 'top_set_and_backoff'
  const assisted = metricKind === 'assistedWeight'
  const loadLabel = (kg: number) => assisted ? `${formatKg(kg)} assist` : formatKg(kg)
  const liftClass = context.liftClass ?? 'upper_or_small'
  const requirement = progressionRequirement(latest, expectation, metricKind, load, sets.length, policy)

  if (currentAction === 'STEP_BACK' && context.stepBackTo) {
    // S6: back to the previous load, aiming for the sets last done there.
    const there = inOrder(context.stepBackTo.comparableWorkingSets)
    const backLoad = bestComparableSet(context.stepBackTo, metricKind)?.weightKg ?? null
    const setTargets = there.map(s => ({ weightKg: s.weightKg, quantity: quantityFor(s, metricKind) ?? (s.reps as number) }))
    const lastThere = setTargets.every(t => t.weightKg === setTargets[0].weightKg)
      ? setTargets.map(t => formatQuantity(t.quantity, unit)).join('/')
      : formatSetTargets(setTargets, metricKind)
    return {
      nextSession: {
        headline: `Step back to ${backLoad != null ? loadLabel(backLoad) : 'the previous load'}: ${lastThere} (your last sets there). Not a setback — build reps there, then try the jump again.`,
        loadKg: backLoad, targetSets: setTargets.length, setTargets, quantityUnit: unit,
        minimumTotalReps: setTargets.reduce((a, t) => a + t.quantity, 0), minimumSetReps: setTargets.map(t => t.quantity),
        explanationCode: 'STEP_BACK_PREVIOUS_LOAD',
      },
      progressionRequirement: progressionRequirement(context.stepBackTo, expectation, metricKind, backLoad, setTargets.length, policy),
    }
  }

  if (currentAction === 'READY_TO_INCREASE') {
    if (!weightBased) {
      // A bodyweight movement at the top of its range: nothing to add a
      // kilogram to, so the progression is a harder version of the exercise.
      return {
        nextSession: {
          headline: `Every set reached ${expectation.repMax != null ? `${expectation.repMax} reps` : 'the top of your range'} twice in a row. Progress by adding weight (a belt or vest) or moving to a harder variation.`,
          loadKg: null, targetSets: sets.length, setTargets: null, quantityUnit: unit,
          minimumTotalReps: null, minimumSetReps: null, explanationCode: 'READY_TO_PROGRESS_VARIATION',
        },
        progressionRequirement: {
          headline: expectation.repMin != null
            ? `Once the harder version reaches ${expectation.repMin} reps on every set, it counts as your new baseline.`
            : 'Once the harder version feels repeatable, it counts as your new baseline.',
          loadKg: null, targetSetReps: null, explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE',
        },
      }
    }
    const smallest = resolveLoadIncrementKg(explicitIncrementKg, equipmentClass, observedIncrements, policy)
    const step = load != null && smallest != null ? resolveLoadStep(load, smallest, liftClass, policy, assisted) : null
    const nextLoad = step?.nextKg ?? null
    const floorReps = expectation.repMin
    const setTargets: SetTarget[] = sets.map((s, i) => {
      const isTop = !isBackoff || i === 0
      const weightKg = isTop ? (nextLoad ?? s.weightKg) : s.weightKg
      const quantity = isTop ? (floorReps ?? (s.reps as number)) : (s.reps as number)
      return { weightKg, quantity }
    })
    const repsClause = floorReps != null ? `${floorReps}+ reps${isBackoff ? ' on the top set' : ' on each set'} is good` : 'staying inside your range is good'
    const topReps = Math.min(...evaluatedReps(latest))
    const expect = step && !assisted ? expectedRepsAfterStep(topReps, step.percent, policy) : null
    const expectClause = expect ? ` (expect about ${expect.low === expect.high ? expect.low : `${expect.low}–${expect.high}`} reps there)` : ''
    let headline: string
    if (nextLoad == null || step == null) {
      const verb = assisted ? 'Cut assistance' : 'Add weight'
      headline = load != null
        ? `${verb} from ${loadLabel(load)} — the smallest step your equipment allows; ${repsClause}.`
        : `${verb} — the smallest step your equipment allows; ${repsClause}.`
    } else {
      const change = assisted ? `down from ${formatKg(load as number)}` : `+${formatKg(step.stepKg)} · +${step.percent} %`
      const what = assisted ? (isBackoff ? 'Cut assistance on the top set' : 'Cut assistance') : (isBackoff ? 'Add weight to the top set' : 'Add weight')
      const backoffs = isBackoff ? `; keep the backoff sets at ${formatSetTargets(setTargets.slice(1), metricKind)}` : ''
      headline = `${what}: ${loadLabel(nextLoad)} (${change})${expectClause} — ${repsClause}${backoffs}. Fewer reps after a jump are normal.`
    }
    const nextLabel = nextLoad != null ? loadLabel(nextLoad) : 'the new load'
    return {
      nextSession: {
        headline, loadKg: nextLoad, targetSets: sets.length, setTargets, quantityUnit: unit,
        minimumTotalReps: null, minimumSetReps: null, explanationCode: 'READY_TO_INCREASE_NEXT_LOAD',
      },
      progressionRequirement: {
        headline: expectation.repMin != null
          ? `At ${nextLabel}, ${expectation.repMin}+ reps on ${isBackoff ? 'the top set' : 'every set'} means the jump held; build reps from there.`
          : `At ${nextLabel}, staying inside your range means the jump held.`,
        loadKg: nextLoad,
        targetSetReps: expectation.repMin != null ? Array(sets.length).fill(expectation.repMin) : null,
        explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE',
      },
    }
  }

  const plan = planStayTargets(sets, previous?.comparableWorkingSets ?? null, metricKind, expectation)
  // One shared load (or none): the line shows the numbers only, in the
  // owner's words — "Repeat 10/10/9 = good"; the big target line above it
  // carries the load. Sets at different loads keep each set's own load.
  const oneLoad = sets.every(st => st.weightKg === sets[0].weightKg)
  const shown = (quantities: readonly number[]) => oneLoad
    ? quantities.map(q => formatQuantity(q, unit)).join('/')
    : formatSetTargets(quantities.map((q, i) => ({ weightKg: sets[i].weightKg, quantity: q })), metricKind)
  const floorText = shown(plan.floor)
  const floorTotal = plan.floor.reduce((a, b) => a + b, 0)
  let headline: string
  let explanationCode: string = plan.code
  let progReq = requirement

  if (currentAction === 'ALMOST_READY' && load != null && expectation.repMax != null) {
    // S5: the smallest step is over 10 % — reps first, or jump now.
    const smallest = resolveLoadIncrementKg(explicitIncrementKg, equipmentClass, observedIncrements, policy)
    const step = smallest != null ? resolveLoadStep(load, smallest, liftClass, policy) : null
    if (step) {
      const repsGoal = expectation.repMax + repsFirstExtra(step.smallestPercent, policy)
      const expect = expectedRepsAfterStep(Math.min(...evaluatedReps(latest)), step.percent, policy)
      const jumpReps = expectation.repMin ?? expect.low
      headline = `${loadLabel(step.nextKg)} would be +${step.percent} % (expect about ${expect.low === expect.high ? expect.low : `${expect.low}–${expect.high}`} reps there). Push reps first, up to ${repsGoal} on ${isBackoff ? 'the top set' : 'each set'} — or try ${loadLabel(step.nextKg)} × ${jumpReps} now; both are progress.`
      explanationCode = 'ALMOST_REPS_FIRST'
      progReq = {
        headline: `Add weight once ${isBackoff ? 'the top set reaches' : 'every set reaches'} ${repsGoal} reps at ${loadLabel(load)} — or jump to ${loadLabel(step.nextKg)} whenever you choose.`,
        loadKg: load, targetSetReps: Array(sets.length).fill(repsGoal), explanationCode: 'PROGRESSION_REQUIREMENT_REPS_FIRST',
      }
    } else headline = `Repeat ${floorText} = good · ${stretchPhrase(unit)}`
  } else if (currentAction === 'REPEAT_AT_TOP' || plan.code === 'REPEAT_TO_CONFIRM') {
    const c = context.confirmations
    const count = c ? ` (top of range ${Math.min(c.count, c.required)} of ${c.required})` : ''
    headline = `Repeat ${floorText} = good${count} · do it again and the next step is weight.`
    if (currentAction === 'REPEAT_AT_TOP') explanationCode = 'REPEAT_TO_CONFIRM'
  } else if (plan.code === 'RECOVER_PREVIOUS' && plan.previous) {
    headline = `Repeat ${floorText} = good · back to ${shown(plan.previous)} = progress.`
  } else if (plan.code === 'MATCH_OR_BEAT') {
    headline = `Match ${floorText} = good · more on any set = progress.`
  } else {
    headline = `Repeat ${floorText} = good · ${stretchPhrase(unit)}.`
  }
  if (currentAction === 'NEW_WEIGHT' && load != null) {
    headline = `New weight — ${headline.charAt(0).toLowerCase()}${headline.slice(1)} Fewer reps after a jump are normal.`
  } else if (currentAction === 'REVIEW_LOAD_REDUCTION' && load != null) {
    headline = `Lighter than last time — ${headline.charAt(0).toLowerCase()}${headline.slice(1)}`
  }

  return {
    nextSession: {
      headline: sentence(headline), loadKg: load, targetSets: sets.length, setTargets: plan.targets, quantityUnit: unit,
      minimumTotalReps: floorTotal,
      minimumSetReps: plan.floor,
      explanationCode: explanationCode === 'MATCH_OR_PROGRESS' ? 'BUILD_NEXT_SESSION' : explanationCode,
    },
    progressionRequirement: progReq,
  }
}

/** Checks a hypothetical next-session vector against a NextTargetResult's
 *  floor — every position must meet or beat `minimumSetReps` AND the total
 *  must meet `minimumTotalReps`. Exported for the verification suite; the
 *  production UI never needs to call this itself. */
export function meetsNextTargetFloor(candidate: readonly number[], target: NextTargetResult['nextSession']): boolean {
  if (!target.minimumSetReps || target.minimumTotalReps == null) return false
  if (candidate.length !== target.minimumSetReps.length) return false
  const perSetOk = candidate.every((r, i) => r >= (target.minimumSetReps as readonly number[])[i])
  const totalOk = candidate.reduce((a, b) => a + b, 0) >= target.minimumTotalReps
  return perSetOk && totalOk
}
