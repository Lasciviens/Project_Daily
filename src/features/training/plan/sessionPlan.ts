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

import type { CanonicalExerciseSession, ExerciseProgressResult, ProgressMetricKind } from '../progress-engine/types'
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
  lastSets: string | null
  lastDate: string | null
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
      lastSets: latest ? formatSessionSets(latest.allSets, kind) : null, lastDate: latest?.date ?? null,
    }
  })
}
