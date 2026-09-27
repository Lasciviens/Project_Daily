// Progress engine — Next Target generation. Action-aware (§6) and always
// concrete: every target is a set-by-set plan where each set keeps its OWN
// load (a top-set+backoff session keeps its backoff load on the backoff sets
// — prescribing the backoff reps at the top-set weight was a real bug).
//
// - READY_TO_INCREASE resolves a real next load via the approved increment
//   ladder (resolveLoadIncrementKg: an explicit per-exercise override > an
//   equipment-class default > the smallest increment ever observed > an
//   honest "smallest step you have", never a fabricated number). For a
//   top-set+backoff session only the top set's load goes up. A bodyweight
//   movement has no load to add: it is told to add weight (a belt or vest)
//   or move to a harder variation instead.
// - Every "stay at this load" action (build, confirm, repeat, watch, and the
//   first session of an exercise) gets double progression: keep the load and
//   add one rep to the first set that is below the minimum, else below the
//   top of the range, else below the session's best set. If a set dropped
//   since last time at the same loads, the target is simply "get back to
//   last time". `minimumSetReps` is the per-position floor (never let a set
//   drop below the latest session); `minimumTotalReps` is derived from it.
// - No numeric target when the latest session can't carry one: mixed loads,
//   a set count that doesn't match the prescription, missing values, or a
//   load reduction whose intent is unknown. `nextTargetBlocker` says which,
//   so the copy layer explains the ACTUAL cause.

import type {
  CanonicalExerciseSession, CanonicalSet, ExpectationRange, NextTargetBlocker, NextTargetResult, ProgressMetricKind,
  CurrentAction, ExerciseProgressionPolicy, SetTarget, TargetQuantityUnit,
} from './types'
import { bestComparableSet } from './normalize'
import { isWeightBasedMetric, quantityFor } from './metricStrategy'
import { resolveLoadIncrementKg } from './policies'
import { formatKg, formatSetTargets, quantityUnitFor } from './format'

function round1(n: number): number { return Math.round(n * 10) / 10 }

/** Actions whose plan is "keep the load and add a little". */
const STAY_AT_LOAD_ACTIONS: ReadonlySet<CurrentAction> = new Set<CurrentAction>([
  'BUILD_AT_CURRENT_LOAD', 'CONFIRM_AT_CURRENT_LOAD', 'CONFIRM_BEFORE_INCREASING', 'HOLD_STEADY',
  'WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'INSUFFICIENT_DATA',
])

/** The step a "repeat and add a little" target adds to one set: one rep, or
 *  five seconds on a timed hold. Distance has no honest fixed step (more
 *  metres, or the same metres faster?), so it is match-or-beat only. A
 *  product rule, not a research finding. */
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
  if (currentAction !== 'READY_TO_INCREASE' && !STAY_AT_LOAD_ACTIONS.has(currentAction)) return 'action'
  return null
}

export type StayPlanCode = 'ADD_ONE_STEP' | 'RECOVER_PREVIOUS' | 'REPEAT_TO_CONFIRM' | 'MATCH_OR_BEAT'

export interface StayPlan {
  code: StayPlanCode
  targets: SetTarget[]
  floor: number[]
  /** Index (0-based, in set order) of the set the step goes on — null when
   *  no single set is singled out. */
  position: number | null
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

  const previous = previousSets ? inOrder(previousSets) : null
  const prevQ = previous?.map(s => quantityFor(s, metricKind)) ?? null
  const sameShape = previous != null && prevQ != null
    && previous.length === latest.length
    && previous.every((s, i) => s.weightKg === latest[i].weightKg)
    && prevQ.every(q => q != null)
  if (sameShape && (prevQ as number[]).some((q, i) => q > floor[i])) {
    const targets = latest.map((s, i) => ({ weightKg: s.weightKg, quantity: Math.max(floor[i], prevQ![i] as number) }))
    return { code: 'RECOVER_PREVIOUS', targets, floor, position: null }
  }

  const step = QUANTITY_STEP[unit]
  if (step === 0) return { code: 'MATCH_OR_BEAT', targets: latest.map((s, i) => ({ weightKg: s.weightKg, quantity: floor[i] })), floor, position: null }

  let position = -1
  if (unit === 'reps' && expectation.repMin != null) position = floor.findIndex(q => q < (expectation.repMin as number))
  if (position < 0 && unit === 'reps' && expectation.repMax != null) {
    position = floor.findIndex(q => q < (expectation.repMax as number))
    if (position < 0) {
      // Every set is already at the top: repeat it to confirm (a pending
      // confirmation or a data-quality flag is why this isn't READY).
      return { code: 'REPEAT_TO_CONFIRM', targets: latest.map((s, i) => ({ weightKg: s.weightKg, quantity: floor[i] })), floor, position: null }
    }
  }
  if (position < 0) {
    const best = Math.max(...floor)
    position = floor.findIndex(q => q < best)
    if (position < 0) position = 0
  }
  const targets = latest.map((s, i) => ({ weightKg: s.weightKg, quantity: floor[i] + (i === position ? step : 0) }))
  return { code: 'ADD_ONE_STEP', targets, floor, position }
}

function stepPhrase(unit: TargetQuantityUnit, position: number): string {
  const what = unit === 'seconds' ? `${QUANTITY_STEP.seconds} s more` : 'one more rep'
  return `${what} on set ${position + 1}`
}

function progressionRequirement(
  latest: CanonicalExerciseSession, expectation: ExpectationRange, metricKind: ProgressMetricKind, loadKg: number | null, setCount: number,
): NextTargetResult['progressionRequirement'] {
  const { repMin, repMax } = expectation
  const at = loadKg != null ? ` at ${metricKind === 'assistedWeight' ? `${formatKg(loadKg)} assist` : formatKg(loadKg)}` : ''
  const targetSetReps = repMax != null ? Array(setCount).fill(repMax) : null
  let headline: string
  if (repMax == null || quantityUnitFor(metricKind) !== 'reps') {
    headline = 'No rep range is saved for this exercise, so there is no fixed point to add load — keep beating last time. Add a rep range to the routine to get one.'
  } else if (!isWeightBasedMetric(metricKind)) {
    headline = `Once every set reaches ${repMax} reps, add weight (a belt or vest) or move to a harder variation.`
  } else if (latest.loadStructure === 'top_set_and_backoff') {
    headline = `Increase the top set once it reaches ${repMax} reps${at}${repMin != null ? `, with every backoff set at ${repMin}+` : ''}.`
  } else if (repMin === repMax) {
    headline = `Increase the load once you complete ${setCount} × ${repMax}${at}.`
  } else {
    headline = `Increase the load once every set reaches ${repMax} reps${at}.`
  }
  return { headline, loadKg, targetSetReps, explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE' }
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
): NextTargetResult | null {
  if (nextTargetBlocker(latest, expectation, metricKind, currentAction) != null) return null
  const sets = inOrder(latest.comparableWorkingSets)
  const unit = quantityUnitFor(metricKind)
  const weightBased = isWeightBasedMetric(metricKind)
  const load = weightBased ? (bestComparableSet(latest, metricKind)?.weightKg ?? null) : null
  const isBackoff = latest.loadStructure === 'top_set_and_backoff'
  const assisted = metricKind === 'assistedWeight'
  const loadLabel = (kg: number) => assisted ? `${formatKg(kg)} assist` : formatKg(kg)

  if (currentAction === 'READY_TO_INCREASE') {
    if (!weightBased) {
      // A bodyweight movement at the top of its range: nothing to add a
      // kilogram to, so the progression is a harder version of the exercise.
      return {
        nextSession: {
          headline: `Every set reached ${expectation.repMax != null ? `${expectation.repMax} reps` : 'the top of your range'}. Progress by adding weight (a belt or vest) or moving to a harder variation.`,
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
    const increment = resolveLoadIncrementKg(explicitIncrementKg, equipmentClass, observedIncrements, policy)
    const nextLoad = load != null && increment != null ? round1(assisted ? load - increment : load + increment) : null
    const floorReps = expectation.repMin
    const setTargets: SetTarget[] = sets.map((s, i) => {
      const isTop = !isBackoff || i === 0
      const weightKg = isTop ? (nextLoad ?? s.weightKg) : s.weightKg
      const quantity = isTop ? (floorReps ?? (s.reps as number)) : (s.reps as number)
      return { weightKg, quantity }
    })
    const repsClause = floorReps != null ? `aim for at least ${floorReps} reps${isBackoff ? '' : ' on each set'}` : 'aim to stay inside your target range'
    let headline: string
    if (nextLoad == null) {
      headline = load != null
        ? `Ready to ${assisted ? 'cut assistance' : 'increase'} from ${loadLabel(load)} — use the smallest step your equipment allows, then ${repsClause}.`
        : `Ready to increase — use the smallest step your equipment allows, then ${repsClause}.`
    } else if (isBackoff) {
      const backoffs = setTargets.slice(1)
      headline = `Ready to ${assisted ? 'cut assistance on' : 'increase'} the top set: ${loadLabel(nextLoad)} (${assisted ? 'down' : 'up'} from ${formatKg(load as number)}), ${repsClause}, then keep the backoff sets at ${formatSetTargets(backoffs, metricKind)}.`
    } else {
      headline = `Ready to ${assisted ? 'cut assistance' : 'increase'}: ${loadLabel(nextLoad)} for ${sets.length} set${sets.length === 1 ? '' : 's'} (${assisted ? 'down' : 'up'} from ${formatKg(load as number)}) — ${repsClause}.`
    }
    const nextLabel = nextLoad != null ? loadLabel(nextLoad) : 'the new load'
    return {
      nextSession: {
        headline, loadKg: nextLoad, targetSets: sets.length, setTargets, quantityUnit: unit,
        minimumTotalReps: null, minimumSetReps: null, explanationCode: 'READY_TO_INCREASE_NEXT_LOAD',
      },
      progressionRequirement: {
        headline: expectation.repMin != null
          ? `Land at or above ${expectation.repMin} reps on ${isBackoff ? 'the top set' : 'every set'} at ${nextLabel} before increasing again.`
          : `Land inside your target range at ${nextLabel} before increasing again.`,
        loadKg: nextLoad,
        targetSetReps: expectation.repMin != null ? Array(sets.length).fill(expectation.repMin) : null,
        explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE',
      },
    }
  }

  const plan = planStayTargets(sets, previous?.comparableWorkingSets ?? null, metricKind, expectation)
  // One shared load: say it once ("Stay at 60 kg: aim for 11/10/10 reps")
  // instead of repeating it inside the set list.
  const stayAt = weightBased && load != null && !isBackoff ? `Stay at ${loadLabel(load)}: ` : ''
  const shown = (quantities: readonly number[]) => formatSetTargets(
    quantities.map((q, i) => ({ weightKg: stayAt ? null : sets[i].weightKg, quantity: q })), stayAt ? 'reps' : metricKind,
  )
  const planText = shown(plan.targets.map(t => t.quantity))
  const floorText = shown(plan.floor)
  let headline: string
  switch (plan.code) {
    case 'RECOVER_PREVIOUS':
      headline = `${stayAt}get back to ${planText} (you managed that last time; this time was ${floorText}).`
      break
    case 'REPEAT_TO_CONFIRM':
      headline = `${stayAt}repeat ${planText} once more to confirm it before adding load.`
      break
    case 'MATCH_OR_BEAT':
      headline = `${stayAt}match or beat ${planText} on every set.`
      break
    default:
      headline = `${stayAt}aim for ${planText} — ${stepPhrase(unit, plan.position ?? 0)}. Don't let any set drop below last time.`
  }
  headline = headline.charAt(0).toUpperCase() + headline.slice(1)

  const floorTotal = plan.floor.reduce((a, b) => a + b, 0)
  const addsSomething = plan.code === 'ADD_ONE_STEP' || plan.code === 'RECOVER_PREVIOUS'
  return {
    nextSession: {
      headline, loadKg: load, targetSets: sets.length, setTargets: plan.targets, quantityUnit: unit,
      minimumTotalReps: floorTotal + (addsSomething ? Math.max(1, QUANTITY_STEP[unit]) : 0),
      minimumSetReps: plan.floor,
      explanationCode: plan.code === 'ADD_ONE_STEP' ? 'BUILD_NEXT_SESSION' : plan.code,
    },
    progressionRequirement: progressionRequirement(latest, expectation, metricKind, load, sets.length),
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
