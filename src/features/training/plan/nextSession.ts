// Which routine the Next tab shows, and the alerts above it — pure and
// import-free apart from type-only imports (scripts/verify-training-plan.cjs).
//
// Order of preference: the next PLANNED training session (a one-off block
// planned from a routine carries that routine's id as its source; a recurring
// template only has a title, so it is matched by name) → otherwise the
// current-program routine trained LEAST recently (never-trained first), which
// is what a rotating split does next. Nothing is guessed when there is no
// current program: the tab asks for one instead.

import type { ExerciseProgressResult } from '../progress-engine/types'

export interface RoutineRef { id: string; title: string }

export interface PlannedRef {
  title: string
  date: string
  startTime: string | null
  /** time_blocks.source_id when the block was planned from a routine. */
  sourceId?: string | null
}

export type NextSource = 'planned' | 'least_recent'

export interface NextRoutinePick {
  source: NextSource
  routineId: string | null
  planned: PlannedRef | null
  /** Last local day the picked routine was trained, null = never. */
  lastTrained: string | null
}

export function normalizeTitle(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The routine a planned session stands for: its source id, else an exact
 *  (normalised) title, else the longest routine title contained in the
 *  plan's title ("Push day — heavy" → "Push day"). Current-program routines
 *  win a tie. */
export function matchRoutineToPlan<R extends RoutineRef>(plan: PlannedRef, routines: readonly R[], programIds: ReadonlySet<string> = new Set()): R | null {
  if (plan.sourceId) {
    const byId = routines.find(r => r.id === plan.sourceId)
    if (byId) return byId
  }
  const pt = normalizeTitle(plan.title)
  if (!pt) return null
  const rank = (r: R) => (programIds.has(r.id) ? 0 : 1)
  const exact = routines.filter(r => normalizeTitle(r.title) === pt).sort((a, b) => rank(a) - rank(b))
  if (exact[0]) return exact[0]
  const contained = routines
    .filter(r => { const t = normalizeTitle(r.title); return t.length >= 3 && (` ${pt} `).includes(` ${t} `) })
    .sort((a, b) => normalizeTitle(b.title).length - normalizeTitle(a.title).length || rank(a) - rank(b))
  return contained[0] ?? null
}

/** The current-program routine to do next when nothing is planned: one never
 *  trained comes first (in program order), otherwise the one trained longest
 *  ago; a tie keeps program order. */
export function pickLeastRecentRoutine(programRoutineIds: readonly string[], lastTrained: ReadonlyMap<string, string>): string | null {
  if (programRoutineIds.length === 0) return null
  return [...programRoutineIds]
    .map((id, order) => ({ id, order, last: lastTrained.get(id) ?? null }))
    .sort((a, b) => {
      if (a.last == null && b.last != null) return -1
      if (b.last == null && a.last != null) return 1
      if (a.last != null && b.last != null && a.last !== b.last) return a.last.localeCompare(b.last)
      return a.order - b.order
    })[0].id
}

export function resolveNextRoutine<R extends RoutineRef>(input: {
  planned: PlannedRef | null
  routines: readonly R[]
  programRoutineIds: readonly string[]
  lastTrained: ReadonlyMap<string, string>
}): NextRoutinePick | null {
  const { planned, routines, programRoutineIds, lastTrained } = input
  const existing = new Set(routines.map(r => r.id))
  const program = programRoutineIds.filter(id => existing.has(id))
  if (planned) {
    const match = matchRoutineToPlan(planned, routines, new Set(program))
    const routineId = match?.id ?? null
    return { source: 'planned', routineId, planned, lastTrained: routineId ? lastTrained.get(routineId) ?? null : null }
  }
  const id = pickLeastRecentRoutine(program, lastTrained)
  if (!id) return null
  return { source: 'least_recent', routineId: id, planned: null, lastTrained: lastTrained.get(id) ?? null }
}

/** Whole days from `from` to `to` (both yyyy-MM-dd, local). */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime()
  const b = new Date(`${to}T12:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export type AlertTone = 'success' | 'warn' | 'danger' | 'info'

export interface TrainingAlert {
  id: string
  tone: AlertTone
  text: string
  exerciseIds: string[]
}

type AlertDecision = Pick<ExerciseProgressResult, 'exerciseTemplateId' | 'currentAction' | 'trend'>

const TONE_ORDER: Record<AlertTone, number> = { danger: 0, warn: 1, success: 2, info: 3 }

function listNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`
}

/** Short, factual alerts from the engine's per-exercise results: lifts ready
 *  for more load, lifts flat at their current load, lifts dropping, a load
 *  that went down without a known reason, and the program-level workload
 *  review. Only restates what the engine decided — no second rule set. */
export function buildTrainingAlerts(
  decisions: readonly AlertDecision[],
  titleOf: (templateId: string) => string,
  program?: { workload: 'continue' | 'review_workload'; corroboratingSignal: string | null; affectedCount: number } | null,
): TrainingAlert[] {
  const out: TrainingAlert[] = []
  const ready = decisions.filter(d => d.currentAction === 'READY_TO_INCREASE')
  if (ready.length > 0) {
    out.push({
      id: 'ready', tone: 'success', exerciseIds: ready.map(d => d.exerciseTemplateId),
      text: `${ready.length} ${ready.length === 1 ? 'lift' : 'lifts'} ready to increase: ${listNames(ready.map(d => titleOf(d.exerciseTemplateId)))}`,
    })
  }
  for (const d of decisions) {
    const flat = d.currentAction === 'WATCH_FOR_PLATEAU' || d.trend.currentLoadProgress === 'POSSIBLE_PLATEAU'
    if (flat && d.currentAction !== 'WATCH_FOR_REGRESSION') {
      const n = d.trend.currentLoadCycleSessions
      out.push({ id: `flat:${d.exerciseTemplateId}`, tone: 'warn', exerciseIds: [d.exerciseTemplateId], text: `${titleOf(d.exerciseTemplateId)} flat for ${n} ${n === 1 ? 'session' : 'sessions'} at this load` })
    }
    if (d.currentAction === 'WATCH_FOR_REGRESSION') {
      out.push({ id: `down:${d.exerciseTemplateId}`, tone: 'danger', exerciseIds: [d.exerciseTemplateId], text: `${titleOf(d.exerciseTemplateId)} dropping at its current load` })
    }
    if (d.currentAction === 'REVIEW_LOAD_REDUCTION') {
      out.push({ id: `lower:${d.exerciseTemplateId}`, tone: 'info', exerciseIds: [d.exerciseTemplateId], text: `${titleOf(d.exerciseTemplateId)}: load went down last time — planned?` })
    }
  }
  if (program?.workload === 'review_workload') {
    out.push({
      id: 'workload', tone: 'danger', exerciseIds: [],
      text: `Review your workload: ${program.affectedCount} lifts declining${program.corroboratingSignal ? `, and ${program.corroboratingSignal}` : ''}`,
    })
  }
  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
}
