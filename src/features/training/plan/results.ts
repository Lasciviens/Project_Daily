// The Results tab's three cards, as numbers — pure (no React, no I/O), sucrase-tested by
// scripts/verify-training-results.cjs. Owner, 27.11.2026: "Scientific results based on proven calculations! …
// Scientific results but not confusing! More understandable." and "My results, what they are how they are".
//
//  - Main lifts: each current-program routine's first exercise, its trend over the last 8 weeks. Estimated 1RM
//    (e1RM) only from sets of 10 reps or fewer (S15, `est1RM`); the start and end are the better of the first two and
//    the last two sessions (`plan/improvement.liftChange`, the same rule as the Improvement summary); within ±3 % is
//    flat (S16); an arrow only once the lift has 3 weeks of data (S13). A lift with no e1RM (every set above 10 reps,
//    or a bodyweight move) shows its reps at one load instead (S12).
//  - Weekly sets per muscle: hard sets — a direct set 1, a helper muscle's 0.5, warm-ups 0 (S17, the counting every
//    volume screen shares: muscleVolumeModel.volumeRowsFromSets → aggregateVolume) — over the last 7 days and the
//    4-week average, read in S18's words (plan/volumeBands.ts).
//  - Consistency: the week model's own sessions (sessionState.planWeek — the This week strip's numbers), the 4 full
//    weeks before this one, the longest break (S27) and the easy-week offer (S31/S32, the coach's own rule).

import { metricKindForExerciseType, type ProgressSetRow } from '../progressAggregate'
import { FLAT_BAND_PCT, exerciseSeries, liftChange, shiftDays, windowStart, type TemplateInfo } from './improvement'
import { MAJOR_MUSCLES, labelForSlug } from '../muscleMap'
import { aggregateVolume, buildTplById, volumeRowsFromSets } from '../components/muscles/muscleVolumeModel'
import { volumeBandOf, type VolumeBand } from './volumeBands'
import { weekCount, type TrainingWeek, type WeekSession } from './sessionState'

const dayDiff = (from: string, to: string): number =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000)

// ── Main lifts ──────────────────────────────────────────────────────────────

/** The trend window of the Main lifts card. */
export const MAIN_LIFT_WEEKS = 8
/** An arrow (up / flat / down) only once a lift's sessions in the window span this many days (S13: ≥ 3 weeks)… */
export const ARROW_MIN_DAYS = 21
/** …and number at least this many (S13: ≥ 4 sessions). */
export const ARROW_MIN_SESSIONS = 4

/** By default the main lifts are each current-program routine's first exercise, in routine order, each once. */
export function mainLiftIds(routines: readonly { exercises?: readonly { exercise_template_id: string; index: number }[] }[]): string[] {
  const out: string[] = []
  for (const r of routines) {
    const first = [...(r.exercises ?? [])].sort((a, b) => a.index - b.index)[0]
    if (first && !out.includes(first.exercise_template_id)) out.push(first.exercise_template_id)
  }
  return out
}

export type Arrow = 'up' | 'flat' | 'down'

export interface E1rmTrend {
  kind: 'e1rm'
  /** kg, the better of the first two sessions in the window; null with fewer than 3 sessions over 2 weeks. */
  start: number | null
  /** kg, the better of the last two sessions (or the only one). */
  end: number
  changePct: number | null
  /** null until ARROW_MIN_SESSIONS sessions span ARROW_MIN_DAYS (S13). */
  arrow: Arrow | null
  sessions: number
  /** Days from the first to the last session in the window. */
  spanDays: number
}

export interface RepsTrend {
  kind: 'reps'
  /** The load of the latest session's heaviest working sets (kg), null for a bodyweight move. */
  loadKg: number | null
  /** The reps at that load in the better of the last two sessions at it (the latest alone when there is one), in set order. */
  latest: number[]
  latestDate: string
  /** The reps at that load in the better of the first two sessions at it, when there are at least 3 such sessions. */
  earlier: number[] | null
  earlierDate: string | null
  /** Sessions in the window with sets at that load. */
  sessions: number
  /** More reps at the same load is progress (S12): the mean reps per set moved by 1 or more (S16: ±1 rep is noise);
   *  null until ARROW_MIN_SESSIONS sessions at the load span ARROW_MIN_DAYS (S13). */
  arrow: Arrow | null
}

export interface MainLift {
  templateId: string
  title: string
  trend: E1rmTrend | RepsTrend | null
}

const WORKING = new Set(['normal', 'failure'])

function arrowOf(changePct: number): Arrow {
  return changePct >= FLAT_BAND_PCT ? 'up' : changePct <= -FLAT_BAND_PCT ? 'down' : 'flat'
}

/** Reps at one load: the latest session's heaviest working sets; the better of the first two sessions at that load
 *  against the better of the last two (the same rule as the e1RM trend, plan/improvement.liftChange). */
export function repsAtLoad(sets: readonly ProgressSetRow[], templateId: string): RepsTrend | null {
  const byWorkout = new Map<string, { date: string; sets: ProgressSetRow[] }>()
  for (const s of sets) {
    if (s.exercise_template_id !== templateId || !WORKING.has(s.set_type) || !(s.reps != null && s.reps > 0)) continue
    const g = byWorkout.get(s.workout_id) ?? { date: s.date, sets: [] }
    g.sets.push(s)
    byWorkout.set(s.workout_id, g)
  }
  const sessions = [...byWorkout.entries()]
    .map(([id, g]) => ({ id, date: g.date, sets: [...g.sets].sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0)) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const last = sessions[sessions.length - 1]
  if (!last) return null
  const loadOf = (xs: readonly ProgressSetRow[]) => {
    const kg = xs.map(s => s.weight_kg ?? 0).filter(w => w > 0)
    return kg.length ? Math.max(...kg) : null
  }
  const load = loadOf(last.sets)
  const at = (xs: readonly ProgressSetRow[]) => xs.filter(s => (load == null ? !(s.weight_kg && s.weight_kg > 0) : s.weight_kg === load)).map(s => s.reps as number)
  const atLoad = sessions.map(s => ({ date: s.date, reps: at(s.sets) })).filter(s => s.reps.length > 0)
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const better = (a: { date: string; reps: number[] }, b: { date: string; reps: number[] } | undefined) => (!b || mean(a.reps) >= mean(b.reps) ? a : b)
  const end = atLoad.length >= 2 ? better(atLoad[atLoad.length - 1], atLoad[atLoad.length - 2]) : atLoad[atLoad.length - 1]
  const start = atLoad.length >= 3 ? better(atLoad[0], atLoad[1]) : null
  let arrow: Arrow | null = null
  if (start && atLoad.length >= ARROW_MIN_SESSIONS && dayDiff(atLoad[0].date, atLoad[atLoad.length - 1].date) >= ARROW_MIN_DAYS) {
    const d = mean(end.reps) - mean(start.reps)
    arrow = d >= 1 ? 'up' : d <= -1 ? 'down' : 'flat'
  }
  return { kind: 'reps', loadKg: load, latest: end.reps, latestDate: end.date, earlier: start?.reps ?? null, earlierDate: start?.date ?? null, sessions: atLoad.length, arrow }
}

/** One main lift over the last `weeks` weeks: e1RM when its sets give one (≤ 10 reps), else reps at a load. */
export function mainLiftTrend(sets: readonly ProgressSetRow[], template: TemplateInfo, today: string, weeks = MAIN_LIFT_WEEKS): E1rmTrend | RepsTrend | null {
  const from = windowStart(today, weeks)
  const inWindow = sets.filter(s => s.date >= from && s.date <= today && s.exercise_template_id === template.id)
  if (metricKindForExerciseType(template.type) === 'est1rm') {
    const series = exerciseSeries(inWindow, template.id, 'est1rm')
    // The latest session must give an e1RM too: an older one alone would read a lift now trained above 10 reps as
    // flat (improvement.ts's high_reps, S15) — its reps at the load say how it moved instead.
    const latestDay = inWindow.filter(s => WORKING.has(s.set_type)).reduce((d, s) => (s.date > d ? s.date : d), '')
    if (series.length > 0 && series[series.length - 1].date >= latestDay) {
      const spanDays = dayDiff(series[0].date, series[series.length - 1].date)
      const change = liftChange(series, 'est1rm', { templateId: template.id, title: template.title })
      const last2 = series.slice(-2).map(s => s.value)
      // Whole percent, and the arrow reads the number shown (S16: no false precision).
      const pct = change.changePct == null ? null : Math.round(change.changePct)
      return {
        kind: 'e1rm', start: change.start, end: change.end ?? Math.max(...last2), changePct: pct,
        arrow: pct != null && series.length >= ARROW_MIN_SESSIONS && spanDays >= ARROW_MIN_DAYS ? arrowOf(pct) : null,
        sessions: series.length, spanDays,
      }
    }
  }
  return repsAtLoad(inWindow, template.id)
}

/** The Main lifts card's rows, in routine order. */
export function mainLifts(sets: readonly ProgressSetRow[], templates: readonly TemplateInfo[], ids: readonly string[], today: string, titleOf?: (id: string) => string | undefined): MainLift[] {
  const byId = new Map(templates.map(t => [t.id, t]))
  // A timed or distance move (a plank, a carry) has no reps or load to compare: it is not a main lift.
  const timed = (id: string) => { const k = metricKindForExerciseType(byId.get(id)?.type ?? 'weight_reps'); return k === 'duration' || k === 'distance' }
  return ids.filter(id => !timed(id)).map(id => {
    const t = byId.get(id)
    const title = t?.title ?? titleOf?.(id) ?? 'Exercise'
    return { templateId: id, title, trend: t ? mainLiftTrend(sets, t, today) : null }
  })
}

// ── Weekly sets per muscle ──────────────────────────────────────────────────

export interface MuscleSets {
  slug: string
  label: string
  /** Hard sets in the last 7 days (rolling, ending today — S17). */
  lastWeek: number
  /** The last 28 days ÷ 4. */
  average: number
  /** S18's words for the 4-week average (one short week doesn't change it). */
  band: VolumeBand
  /** An active limitation reaches this muscle (muscleMap.restrictionsBySlug): a low number may be deliberate. */
  restriction: 'avoid' | 'limit' | null
}

type HistoryTemplate = { id: string; title: string; primary_muscle_group: string | null; secondary_muscle_groups?: string[] | null }

/** Weekly hard sets per muscle: every main muscle, and any other muscle trained in the last 4 weeks, most sets
 *  first. `restrictions`: the active limitations by muscle (muscleMap.restrictionsBySlug). */
export function weeklyMuscleSets(
  sets: readonly ProgressSetRow[],
  templates: readonly HistoryTemplate[],
  today: string,
  restrictions: ReadonlyMap<string, { weight: 'avoid' | 'limit' }> = new Map(),
): MuscleSets[] {
  const tpl = buildTplById(templates)
  const week = aggregateVolume(volumeRowsFromSets(sets, shiftDays(today, -6), today), tpl).perSlug
  const four = aggregateVolume(volumeRowsFromSets(sets, shiftDays(today, -27), today), tpl).perSlug
  const slugs = new Set<string>([...MAJOR_MUSCLES, ...Object.keys(four)])
  return [...slugs].map(slug => {
    const average = (four[slug]?.credited ?? 0) / 4
    return {
      slug, label: labelForSlug(slug),
      lastWeek: week[slug]?.credited ?? 0, average, band: volumeBandOf(average),
      restriction: restrictions.get(slug)?.weight ?? null,
    }
  }).sort((a, b) => b.average - a.average || b.lastWeek - a.lastWeek || a.label.localeCompare(b.label))
}

/** The reframe for a limited muscle (the body map's words): a low number there may be deliberate. Null when the
 *  muscle is at target or above, or no limitation reaches it. */
export function limitationNote(m: Pick<MuscleSets, 'restriction' | 'band'>): string | null {
  if (!m.restriction || m.band.idx >= 3) return null
  return `Low — your active ${m.restriction} limitation reaches it, so that may be deliberate.`
}

// ── Consistency ─────────────────────────────────────────────────────────────

export interface WeeksTally {
  /** Sessions planned in those weeks, each week counted as the strip counts it (`weekCount`: a skipped one left out). */
  planned: number
  done: number
  /** done ÷ planned, whole percent; null with nothing planned. */
  pct: number | null
  /** Done on its day (or ticked by hand). */
  onDay: number
  /** Done 1–6 days after its day. */
  late: number
  /** Done 1–2 days before its day. */
  early: number
  /** Skipped (by you, or not done within its week) — not in planned, like the strip. */
  skipped: number
  /** Planned, not done and not skipped: its day and its week passed (missed). */
  dropped: number
}

/** The weeks' own sessions (Monday–Sunday of each), counted once each, by the strip's own rule (`weekCount`). */
export function tallyWeeks(weeks: readonly TrainingWeek[]): WeeksTally {
  let planned = 0, doneCount = 0
  for (const w of weeks) { const c = weekCount(w); planned += c.planned; doneCount += c.done }
  const own: WeekSession[] = weeks.flatMap(w => w.sessions.filter(s => s.date >= w.monday && s.date <= w.sunday))
  const done = own.filter(s => s.mark === 'done')
  const late = done.filter(s => (s.shift ?? 0) > 0).length
  const early = done.filter(s => (s.shift ?? 0) < 0).length
  return {
    planned, done: doneCount, pct: planned > 0 ? Math.round((doneCount / planned) * 100) : null,
    onDay: done.length - late - early, late, early,
    skipped: own.filter(s => s.mark === 'skipped').length,
    dropped: own.filter(s => s.mark !== 'skipped' && s.status.state === 'missed').length,
  }
}

/** The Mondays of the `n` full weeks before `today`'s week, oldest first. */
export function previousMondays(today: string, n = 4): string[] {
  const back = (new Date(`${today}T12:00:00`).getDay() + 6) % 7
  const monday = shiftDays(today, -back)
  return Array.from({ length: n }, (_, i) => shiftDays(monday, -7 * (n - i)))
}

export interface LongestBreak {
  days: number
  /** The training day it started after. */
  from: string
  /** The training day it ended on, or null when it is still going (to today). */
  to: string | null
}

/** The longest stretch from one training day to the next (or to today) inside the last `days` days; the session
 *  before the window counts as its start. Measured like the break note (gapNote): days from one session to the next. */
export function longestBreak(trainingDays: readonly string[], today: string, days = 28): LongestBreak | null {
  const from = shiftDays(today, -(days - 1))
  const sorted = [...new Set(trainingDays.filter(d => d <= today))].sort()
  const before = sorted.filter(d => d < from).pop()
  const inside = sorted.filter(d => d >= from)
  const points = before ? [before, ...inside] : inside
  if (points.length === 0) return null
  let best: LongestBreak | null = null
  for (let i = 1; i < points.length; i++) {
    const d = dayDiff(points[i - 1], points[i])
    if (!best || d > best.days) best = { days: d, from: points[i - 1], to: points[i] }
  }
  const tail = dayDiff(points[points.length - 1], today)
  if (!best || tail > best.days) best = { days: tail, from: points[points.length - 1], to: null }
  return best
}

/** S27's note is shown only while a break is still running and has lasted 7+ days (a finished break needs no
 *  word), and only up to 14 days — a longer one gets Today's comeback note (sessionState.gapNote). */
export function showBreakNote(gap: LongestBreak | null): boolean {
  return !!gap && gap.to === null && gap.days >= 7 && breakNote(gap.days) != null
}

/** S27's plain note: a break of 14 days or less costs nothing. Null for a longer one. */
export function breakNote(days: number): string | null {
  return days <= 14 ? 'Breaks of 14 days or less cost nothing — carry on with the plan as it is.' : null
}
