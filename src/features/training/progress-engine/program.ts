// Progress engine — program-level reads over the per-exercise results, plus
// the current-program scoping rules. Pure, import-free of runtime deps
// except sibling engine modules and progressAggregate's week keys.
//
// Two DISTINCT program facets, deliberately never merged into one score:
// progressVerdict (is progress real across the program?) and workload
// (should the training load itself change?). Workload review structurally
// needs >= 2 different exercises declining PLUS a second, independent signal
// (a sleep drop) — never one exercise alone.

import type { ExerciseProgressResult, ProgressEventCode } from './types'
import { shiftWeek } from '../progressAggregate'

export type ProgressVerdict = 'progressing' | 'mixed' | 'insufficient_data'
export type WorkloadDecision = 'continue' | 'review_workload'

export interface ProgramDecision {
  progressVerdict: ProgressVerdict
  workload: WorkloadDecision
  analyzableCount: number
  improvingCount: number
  /** Exercises whose recent window holds at least 4 comparable sessions
   *  spanning at least 2 weeks (moderate or strong progress evidence). */
  reliableCount: number
  affectedExerciseIds: string[]
  corroboratingSignal: string | null
}

/** A measured improvement in the latest session: a 6-month best or a
 *  completed target. The estimated-strength event is secondary and doesn't
 *  count on its own. */
const IMPROVEMENT_EVENTS: ReadonlySet<ProgressEventCode> = new Set<ProgressEventCode>([
  'LOAD_PR', 'REP_PR_AT_LOAD', 'TOTAL_REPS_PR_AT_LOAD', 'TARGET_COMPLETED',
])

/** Judgeable at all: at least two sessions to compare. */
export function isAnalyzable(r: ExerciseProgressResult): boolean {
  return r.currentAction !== 'INSUFFICIENT_DATA'
}

/** "Improved" = the recent trend is progressing, or the latest session set a
 *  6-month best / completed its target. Merely building at the same load no
 *  longer counts — that inflated "X of Y improved". */
export function isImproving(r: ExerciseProgressResult): boolean {
  return isAnalyzable(r) && (r.trend.recentProgressTrend === 'PROGRESSING' || r.events.some(e => IMPROVEMENT_EVENTS.has(e.code)))
}

/** A repeated, beyond-noise decline at the current load. */
export function isDeclining(r: ExerciseProgressResult): boolean {
  return r.currentAction === 'WATCH_FOR_REGRESSION'
}

export function isReliable(r: ExerciseProgressResult): boolean {
  return isAnalyzable(r) && r.evidence.progress !== 'limited'
}

const REVIEW_WORKLOAD_MIN_DECLINING = 2

export function computeProgramDecision(
  results: readonly ExerciseProgressResult[],
  corroboratingSignal: { label: string } | null,
): ProgramDecision {
  const analyzable = results.filter(isAnalyzable)
  const improving = analyzable.filter(isImproving)
  const declining = analyzable.filter(isDeclining)

  let progressVerdict: ProgressVerdict = 'insufficient_data'
  if (analyzable.length > 0) progressVerdict = improving.length / analyzable.length > 0.5 ? 'progressing' : 'mixed'

  const workload: WorkloadDecision = declining.length >= REVIEW_WORKLOAD_MIN_DECLINING && corroboratingSignal ? 'review_workload' : 'continue'

  return {
    progressVerdict, workload,
    analyzableCount: analyzable.length,
    improvingCount: improving.length,
    reliableCount: results.filter(isReliable).length,
    affectedExerciseIds: declining.map(d => d.exerciseTemplateId),
    corroboratingSignal: workload === 'review_workload' ? (corroboratingSignal?.label ?? null) : null,
  }
}

export function progressVerdictHeadline(verdict: ProgressVerdict): string {
  switch (verdict) {
    case 'progressing':       return 'Progressing'
    case 'mixed':             return 'Mixed'
    case 'insufficient_data': return 'Not enough data yet'
  }
}

export function workloadLabel(workload: WorkloadDecision): string {
  return workload === 'review_workload' ? 'Review workload' : 'Continue'
}

// ── Sleep as the second, independent workload signal ────────────────────────
export interface WeeklySleepInput { weekStart: string; avgHours: number | null }

const SLEEP_DROP_HOURS = 0.75

/** "Sleep down ~Xh/night": the last two COMPLETE weeks against the two
 *  before them, every one of the four weeks carrying its own average (the
 *  weekly series already requires >= 4 tracked nights per week). The old
 *  version took the last two weeks that HAD data — possibly months old —
 *  and counted the week still in progress. */
export function sleepCorroboratingSignal(weekly: readonly WeeklySleepInput[], lastCompleteWeek: string): { label: string } | null {
  const byWeek = new Map(weekly.map(w => [w.weekStart, w.avgHours]))
  const hours = [0, -1, -2, -3].map(offset => byWeek.get(shiftWeek(lastCompleteWeek, offset)) ?? null)
  if (hours.some(h => h == null)) return null
  const [w0, w1, p0, p1] = hours as number[]
  const recentAvg = (w0 + w1) / 2
  const priorAvg = (p0 + p1) / 2
  if (recentAvg >= priorAvg - SLEEP_DROP_HOURS) return null
  return { label: `sleep down ~${Math.round((priorAvg - recentAvg) * 10) / 10}h/night over the last 2 complete weeks` }
}

// ── Current-program scoping ─────────────────────────────────────────────────
/** A set counts toward decisions when its workout belongs to the explicit
 *  current program, OR was freeform (no routine at all). A set tied to a
 *  KNOWN OTHER routine is old-program history and is excluded. With no
 *  program selected nothing is filtered — callers gate on that themselves
 *  (the Progress page refuses to decide without a selection). */
export function filterToCurrentProgram<T extends { routine_id?: string | null }>(sets: readonly T[], currentProgramRoutineIds: ReadonlySet<string>): T[] {
  if (currentProgramRoutineIds.size === 0) return [...sets]
  return sets.filter(s => s.routine_id == null || currentProgramRoutineIds.has(s.routine_id))
}

/** The last LOCAL day each routine was actually trained (from workouts'
 *  routine_id + date) — not when the routine was last edited in Hevy. */
export function lastTrainedByRoutine(sets: readonly { routine_id?: string | null; date: string }[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of sets) {
    if (!s.routine_id) continue
    const prev = out.get(s.routine_id)
    if (!prev || s.date > prev) out.set(s.routine_id, s.date)
  }
  return out
}

export const SUGGESTION_WINDOW_DAYS = 28

/** Routines trained in the last `days` days (a starting suggestion for the
 *  current-program picker — the athlete still confirms it). Ordered most
 *  recently trained first; only ids in `routineIds` (routines that still
 *  exist) are returned. */
export function suggestCurrentProgramRoutineIds(
  routineIds: readonly string[],
  sets: readonly { routine_id?: string | null; date: string }[],
  today: string,
  days = SUGGESTION_WINDOW_DAYS,
): string[] {
  const last = lastTrainedByRoutine(sets)
  const cutoff = new Date(today + 'T00:00:00')
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  return routineIds
    .filter(id => { const d = last.get(id); return d != null && d >= cutoffStr })
    .sort((a, b) => (last.get(b) as string).localeCompare(last.get(a) as string))
}
