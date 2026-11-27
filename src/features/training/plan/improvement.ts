// "Am I getting stronger?" over a chosen window (4 / 12 / 26 weeks) — pure,
// runtime imports only from progressAggregate (the ONE est1RM), tested by
// scripts/verify-training-plan.cjs.
//
// Per exercise, each session is reduced to one number in the exercise's own
// metric (progressAggregate.metricKindForExerciseType): estimated 1RM for a
// weighted lift, top-set reps for a bodyweight movement, added weight, LEAST
// assistance, longest hold, longest distance. The start of the window is the
// better of its first two sessions and the end the better of its last two —
// one off-day at either end doesn't decide the verdict. A change within
// ±3% is "flat": day-to-day scatter is about 3–6 % (S16), so a smaller change
// is noise. e1RM is an estimate — its direction over time matters, not the
// exact number.

import { est1RM, metricKindForExerciseType, type ProgressMetricKind, type ProgressSetRow } from '../progressAggregate'

export const WINDOW_WEEKS = [4, 12, 26] as const
export type WindowWeeks = typeof WINDOW_WEEKS[number]

export const FLAT_BAND_PCT = 3
export const MIN_SESSIONS = 3
export const MIN_SPAN_DAYS = 14

export interface TemplateInfo { id: string; title: string; type: string }

export interface SessionValue { date: string; workoutId: string; value: number }

/** Lower is better only for assistance (less help = stronger). */
export function higherIsBetter(kind: ProgressMetricKind): boolean {
  return kind !== 'assistedWeight'
}

const COUNTED = new Set(['normal', 'failure'])

/** One session's number in the exercise's own metric, or null. Warm-ups and
 *  dropsets never count. */
export function sessionTopValue(sets: readonly ProgressSetRow[], kind: ProgressMetricKind): number | null {
  const vals: number[] = []
  for (const s of sets) {
    if (!COUNTED.has(s.set_type)) continue
    switch (kind) {
      case 'est1rm':
        if (s.weight_kg != null && s.weight_kg > 0) { const e = est1RM(s.weight_kg, s.reps); if (e != null) vals.push(e) }
        break
      case 'reps':
        if (s.reps != null && s.reps > 0) vals.push(s.reps)
        break
      case 'addedWeight':
        if (s.weight_kg != null && s.weight_kg > 0) vals.push(s.weight_kg)
        break
      case 'assistedWeight':
        if (s.weight_kg != null && s.weight_kg >= 0 && (s.reps ?? 0) > 0) vals.push(s.weight_kg)
        break
      case 'duration':
        if (s.duration_seconds != null && s.duration_seconds > 0) vals.push(s.duration_seconds)
        break
      case 'distance':
        if (s.distance_meters != null && s.distance_meters > 0) vals.push(s.distance_meters)
        break
    }
  }
  if (vals.length === 0) return null
  return higherIsBetter(kind) ? Math.max(...vals) : Math.min(...vals)
}

/** Every session of one exercise with a value, oldest first. */
export function exerciseSeries(sets: readonly ProgressSetRow[], templateId: string, kind: ProgressMetricKind): SessionValue[] {
  const byWorkout = new Map<string, { date: string; sets: ProgressSetRow[] }>()
  for (const s of sets) {
    if (s.exercise_template_id !== templateId) continue
    const g = byWorkout.get(s.workout_id) ?? { date: s.date, sets: [] }
    g.sets.push(s)
    byWorkout.set(s.workout_id, g)
  }
  const out: SessionValue[] = []
  for (const [workoutId, g] of byWorkout) {
    const value = sessionTopValue(g.sets, kind)
    if (value != null) out.push({ date: g.date, workoutId, value })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.workoutId.localeCompare(b.workoutId))
}

export function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** First day of a window of `weeks` weeks ending today (inclusive). */
export function windowStart(today: string, weeks: number): string {
  return shiftDays(today, -(weeks * 7) + 1)
}

function daysApart(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000)
}

/** `high_reps`: an est1rm lift with enough sessions, but its first or last sessions had no set of ≤ 10 reps, so no e1RM
 *  to compare (S15) — never judged on older sessions alone; the Progress table judges its reps at the load (S12). */
export type LiftStatus = 'improved' | 'flat' | 'declined' | 'insufficient' | 'high_reps'

export interface LiftChange {
  templateId: string
  title: string
  kind: ProgressMetricKind
  sessions: number
  start: number | null
  end: number | null
  /** Improvement in percent, positive = better (assistance inverted). */
  changePct: number | null
  status: LiftStatus
  firstDate: string | null
  lastDate: string | null
}

function better(kind: ProgressMetricKind, a: number, b: number): number {
  return higherIsBetter(kind) ? Math.max(a, b) : Math.min(a, b)
}

export function liftChange(series: readonly SessionValue[], kind: ProgressMetricKind, info: { templateId: string; title: string }): LiftChange {
  const base = { templateId: info.templateId, title: info.title, kind, sessions: series.length, firstDate: series[0]?.date ?? null, lastDate: series[series.length - 1]?.date ?? null }
  if (series.length < MIN_SESSIONS || daysApart(series[0].date, series[series.length - 1].date) < MIN_SPAN_DAYS) {
    return { ...base, start: null, end: null, changePct: null, status: 'insufficient' }
  }
  const start = better(kind, series[0].value, series[1].value)
  const end = better(kind, series[series.length - 1].value, series[series.length - 2].value)
  let changePct: number
  if (start === 0) changePct = end === 0 ? 0 : (higherIsBetter(kind) ? 100 : -100)
  else changePct = higherIsBetter(kind) ? ((end - start) / start) * 100 : ((start - end) / start) * 100
  changePct = Math.round(changePct * 10) / 10
  const status: LiftStatus = changePct >= FLAT_BAND_PCT ? 'improved' : changePct <= -FLAT_BAND_PCT ? 'declined' : 'flat'
  return { ...base, start, end, changePct, status }
}

/** Every session of one exercise (warm-up-only ones aside), with its value or null, oldest first. */
function allSessions(sets: readonly ProgressSetRow[], templateId: string, kind: ProgressMetricKind): { date: string; value: number | null }[] {
  const byWorkout = new Map<string, { date: string; sets: ProgressSetRow[] }>()
  for (const s of sets) {
    if (s.exercise_template_id !== templateId || !COUNTED.has(s.set_type)) continue
    const g = byWorkout.get(s.workout_id) ?? { date: s.date, sets: [] }
    g.sets.push(s)
    byWorkout.set(s.workout_id, g)
  }
  return [...byWorkout.entries()].map(([id, g]) => ({ id, date: g.date, value: sessionTopValue(g.sets, kind) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/** An est1rm lift whose first or last two sessions have no e1RM (every set above 10 reps, S15): enough sessions to
 *  judge, but not by e1RM — `high_reps`, so the card never reads it "flat" off older sessions while the Progress
 *  table (reps at the load, S12) says it moved. */
function highRepsOnly(all: readonly { date: string; value: number | null }[]): boolean {
  if (all.length < MIN_SESSIONS || daysApart(all[0].date, all[all.length - 1].date) < MIN_SPAN_DAYS) return false
  return [all[0], all[1], all[all.length - 2], all[all.length - 1]].some(s => s.value == null)
}

/** Every exercise trained in the window, with its change. */
export function computeLiftChanges(sets: readonly ProgressSetRow[], templates: readonly TemplateInfo[], today: string, weeks: number): LiftChange[] {
  const from = windowStart(today, weeks)
  const inWindow = sets.filter(s => s.date >= from && s.date <= today)
  const byId = new Map(templates.map(t => [t.id, t]))
  const ids = [...new Set(inWindow.map(s => s.exercise_template_id))]
  return ids.map(id => {
    const t = byId.get(id)
    const kind = metricKindForExerciseType(t?.type ?? 'weight_reps')
    const info = { templateId: id, title: t?.title ?? 'Unknown exercise' }
    if (kind === 'est1rm') {
      const all = allSessions(inWindow, id, kind)
      if (highRepsOnly(all)) {
        return { ...info, kind, sessions: all.length, start: null, end: null, changePct: null, status: 'high_reps' as const, firstDate: all[0].date, lastDate: all[all.length - 1].date }
      }
    }
    return liftChange(exerciseSeries(inWindow, id, kind), kind, info)
  }).sort((a, b) => b.sessions - a.sessions || a.title.localeCompare(b.title))
}

export interface ImprovementSummary { improved: number; flat: number; declined: number; judged: number; insufficient: number; highReps: number }

export function summarizeImprovement(changes: readonly LiftChange[]): ImprovementSummary {
  const count = (s: LiftStatus) => changes.filter(c => c.status === s).length
  const improved = count('improved'), flat = count('flat'), declined = count('declined')
  return { improved, flat, declined, judged: improved + flat + declined, insufficient: count('insufficient'), highReps: count('high_reps') }
}

/** The main weighted lifts: estimated-1RM exercises that could be judged,
 *  most-trained first (ties: higher estimate first). `preferIds` (e.g. the
 *  current program's exercises) are ranked ahead of everything else. */
export function mainLifts(changes: readonly LiftChange[], n = 5, preferIds: ReadonlySet<string> = new Set()): LiftChange[] {
  return changes
    .filter(c => c.kind === 'est1rm' && c.status !== 'insufficient' && c.status !== 'high_reps')
    .sort((a, b) => Number(preferIds.has(b.templateId)) - Number(preferIds.has(a.templateId)) || b.sessions - a.sessions || (b.end ?? 0) - (a.end ?? 0))
    .slice(0, n)
}

export interface WindowBodyweight { startKg: number; endKg: number; deltaKg: number; startDate: string; endDate: string }

/** Bodyweight at the start vs the end of the window — the mean of the
 *  weigh-ins in the first 14 days against the mean of the last 14, so one
 *  day's water swing doesn't decide it. Null without a weigh-in in both
 *  stretches or when they overlap (a window shorter than ~4 weeks of data). */
export function bodyweightOverWindow(anchors: readonly { date: string; kg: number }[], today: string, weeks: number): WindowBodyweight | null {
  const from = windowStart(today, weeks)
  const inWin = anchors.filter(a => a.date >= from && a.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  if (inWin.length < 2) return null
  const firstEnd = shiftDays(inWin[0].date, 13)
  const lastStart = shiftDays(inWin[inWin.length - 1].date, -13)
  const early = inWin.filter(a => a.date <= firstEnd)
  const late = inWin.filter(a => a.date >= lastStart)
  if (lastStart <= firstEnd) return null
  const avg = (xs: typeof inWin) => Math.round((xs.reduce((s, a) => s + a.kg, 0) / xs.length) * 10) / 10
  const startKg = avg(early), endKg = avg(late)
  return { startKg, endKg, deltaKg: Math.round((endKg - startKg) * 10) / 10, startDate: inWin[0].date, endDate: inWin[inWin.length - 1].date }
}
