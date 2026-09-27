// One routine turned into "what to lift today": per exercise the program's
// prescription, the progress engine's set-by-set target (each set keeps its
// own load — backoff sets keep the backoff weight) and last session's
// numbers. Pure — runtime imports only from other pure modules — tested by
// scripts/verify-training-plan.cjs. (A warm-up ramp and the routine's
// exercise notes were shown here once; both removed on the owner's call —
// the notes stay in Library → Routines.)
//
// No decision is made here: the target is the engine's (progress-engine
// targets.ts), this only lines it up with the routine.
//
// RPE (logged per set in Hevy) is shown on "Last time" and read into one
// light note — near your limit / room to push (lastSessionEffort). The note
// is informational and NEVER changes the target: the owner decided that no
// decision depends on RPE (the engine reads none — a rated and an unrated
// exercise must get the same target), RPE is self-reported and people misjudge
// the reps they have left by about one (Halperin 2022), and there is only a
// short history of rated sets.

import type { CanonicalExerciseSession, CanonicalSet, ExerciseProgressResult, ProgressMetricKind } from '../progress-engine/types'
import { formatSessionSets, formatSetTargets } from '../progress-engine/format'
import { routineTargetFromSets, repRangeLabel } from '../progress-engine/policies'

export interface RoutineSetInput {
  type: string
  weight_kg: number | null
  reps: number | null
  rep_range_start: number | null
  rep_range_end: number | null
  duration_seconds: number | null
  distance_meters: number | null
}

export interface RoutineExerciseInput {
  exercise_template_id: string
  title: string
  index: number
  rest_seconds?: string | number | null
  sets?: readonly RoutineSetInput[]
}

export interface PlanRow {
  templateId: string
  title: string
  order: number
  metricKind: ProgressMetricKind
  restSeconds: number | null
  /** "3 × 8-12 reps" from the routine, or null when nothing is prescribed. */
  prescription: string | null
  /** The planned loads the routine itself stores ("60 kg × 10/10/10"). */
  routineLoads: string | null
  /** The engine's target for this session, or null. */
  target: string | null
  targetHeadline: string | null
  decision: ExerciseProgressResult | null
  /** Last session's sets, each group with its RPE when rated ("… @ RPE 8/9/10"). */
  lastSets: string | null
  lastDate: string | null
  /** At least one set of the last session was rated in Hevy. */
  lastHasRpe: boolean
  /** The last session's effort read from its RPE, or null (too few rated sets). */
  lastEffort: LastEffort | null
}

// ─── Effort from RPE (informational only) ───────────────────────────────────
// Hevy's mapping: reps in reserve ≈ 10 − RPE. An average of 9.5+ ≈ 0–½ reps
// left; 7 or lower ≈ 3+ left. Working sets = normal + failure (dropsets are
// deliberately taken past the point, so they'd skew the read).

export const NEAR_LIMIT_RPE = 9.5
export const ROOM_TO_PUSH_RPE = 7

export type EffortNote = 'near_limit' | 'room_to_push'

export interface LastEffort {
  /** Average RPE of the rated working sets, one decimal. */
  averageRpe: number
  ratedSets: number
  workingSets: number
  /** null = an ordinary effort (between 7 and 9.5) — nothing to say. */
  note: EffortNote | null
  /** The card's sentence, or null with no note. */
  text: string | null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const isRated = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Needs RPE on at least half of the session's working sets — one rated set
 *  out of four is not the session's effort (the research note: no effort
 *  read from a small share of rated sets). */
export function lastSessionEffort(sets: readonly CanonicalSet[]): LastEffort | null {
  const working = sets.filter(s => s.kind !== 'dropset')
  const rated = working.map(s => s.rpe).filter(isRated)
  if (working.length === 0 || rated.length === 0 || rated.length * 2 < working.length) return null
  const averageRpe = Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10
  const note: EffortNote | null = averageRpe >= NEAR_LIMIT_RPE ? 'near_limit' : averageRpe <= ROOM_TO_PUSH_RPE ? 'room_to_push' : null
  const over = rated.length === working.length ? plural(working.length, 'working set') : `${rated.length} of ${plural(working.length, 'working set')}`
  const text = note === 'near_limit'
    ? `Last time was near your limit (RPE 9.5+) — average ${averageRpe} over ${over}, about 0–½ reps left.`
    : note === 'room_to_push'
      ? `Last time left room to push (RPE 7 or lower) — average ${averageRpe} over ${over}, about 3+ reps left.`
      : null
  return { averageRpe, ratedSets: rated.length, workingSets: working.length, note, text }
}

function routineLoadsText(sets: readonly RoutineSetInput[], kind: ProgressMetricKind): string | null {
  const working = sets.filter(s => s.type !== 'warmup')
  if (working.length === 0 || !working.some(s => s.weight_kg != null && s.weight_kg > 0)) return null
  return formatSessionSets(working.map((s, i) => ({
    order: i, kind: s.type === 'dropset' ? 'dropset' as const : s.type === 'failure' ? 'failure' as const : 'normal' as const,
    weightKg: s.weight_kg, reps: s.reps ?? s.rep_range_end ?? null, durationSeconds: s.duration_seconds, distanceMeters: s.distance_meters,
  })), kind)
}

function parseRest(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function buildSessionPlan(
  exercises: readonly RoutineExerciseInput[],
  ctx: {
    decisionById: ReadonlyMap<string, ExerciseProgressResult>
    sessionsById: ReadonlyMap<string, readonly CanonicalExerciseSession[]>
    metricKindById: ReadonlyMap<string, ProgressMetricKind>
  },
): PlanRow[] {
  return [...exercises].sort((a, b) => a.index - b.index).map((ex, i) => {
    const id = ex.exercise_template_id
    const sets = ex.sets ?? []
    const decision = ctx.decisionById.get(id) ?? null
    const kind = decision?.metricKind ?? ctx.metricKindById.get(id) ?? 'est1rm'
    const rt = routineTargetFromSets(sets)
    const prescription = rt ? `${rt.targetSets} × ${repRangeLabel(rt.repMin, rt.repMax)}` : (sets.filter(s => s.type !== 'warmup').length > 0 ? `${sets.filter(s => s.type !== 'warmup').length} sets` : null)
    const sessions = ctx.sessionsById.get(id) ?? []
    const latest = sessions[sessions.length - 1] ?? null
    const next = decision?.nextTargets?.nextSession ?? null
    const target = next?.setTargets ? formatSetTargets(next.setTargets, kind) : null
    return {
      templateId: id, title: ex.title, order: i + 1, metricKind: kind,
      restSeconds: parseRest(ex.rest_seconds),
      prescription, routineLoads: routineLoadsText(sets, kind),
      target, targetHeadline: next?.headline ?? null, decision,
      lastSets: latest ? formatSessionSets(latest.allSets, kind, { rpe: true }) : null, lastDate: latest?.date ?? null,
      lastHasRpe: !!latest && latest.allSets.some(s => isRated(s.rpe)),
      lastEffort: latest ? lastSessionEffort(latest.allSets) : null,
    }
  })
}
