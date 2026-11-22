// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the week's figures (weekly report, phase 3)
//
//  AI last: every number of the weekly report is worked out here, by code, from rows the database already holds.
//  The model only reads the prepared text (`factsText`) and says what it means. Nothing here touches the network or
//  the database: week-data.ts reads the rows, this part turns them into figures, so each rule can be checked on its
//  own (scripts/verify-claude-function.cjs).
//
//  The week is Monday to Sunday in Europe/Oslo, whatever clock the server has. A day is the Oslo day: a session at
//  00:30 on a Monday is Monday's. The rules mirror the app's own where it has one: working sets are every set that
//  is not a warm-up; a muscle gets one credited set for a primary muscle and a half for a secondary one (the Muscles
//  tab's convention); the night of sleep belongs to the day you woke up and is merged and summed by the sleep
//  contract (healthAggregate.ts, hand-mirrored in ai-proxy and phone-gateway: this is the fourth copy, kept in step
//  by verify-ai-sleep-merge); steps and energy are collapsed per hour first (the Health tab's rule); a task counts as
//  closed on the day of `completed_at`, never `updated_at`.
//
//  Every free text that reaches the model (a workout title, an exercise, a task title) is input: it is cut, made one
//  line, escaped and put inside its own tag by `factsText`.
// ─────────────────────────────────────────────────────────────────────────────

import { checkedLine, escapeTagText } from './answer-reader.ts'

type Row = Record<string, unknown>

// ── The week ────────────────────────────────────────────────────────────────

const OSLO = 'Europe/Oslo'
const DAY_MS = 86_400_000

/** The Oslo calendar day (YYYY-MM-DD) an instant falls on. */
export function osloDay(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: OSLO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The Oslo wall clock of an instant: hour and minute, and the weekday (1 = Monday … 7 = Sunday). */
export function osloClock(at: Date): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: OSLO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday }
}

/** A date string moved by whole days (calendar arithmetic at noon UTC, so no clock change can shift it). */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Minutes Oslo is ahead of UTC at an instant (60 in winter, 120 in summer time). */
function osloOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: OSLO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'))
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000)
}

/** The instant an Oslo day starts (its 00:00). The clocks change at night, never at midnight, so one correction is enough. */
export function osloMidnight(day: string): Date {
  const guess = new Date(`${day}T00:00:00Z`)
  const first = new Date(guess.getTime() - osloOffsetMinutes(guess) * 60_000)
  return new Date(guess.getTime() - osloOffsetMinutes(first) * 60_000)
}

export interface WeekRange {
  /** Monday. */
  start: string
  /** Sunday. */
  end: string
  /** The seven days, Monday first. */
  days: string[]
  /** The instant Monday starts, and the instant the next Monday starts (the end is exclusive). */
  startAt: string
  endAt: string
  /** The Monday of the week before. */
  prevStart: string
}

/** The Oslo week (Monday to Sunday) that contains an instant. */
export function osloWeekOf(at: Date): WeekRange {
  const today = osloDay(at)
  const weekday = osloClock(at).weekday
  return osloWeek(shiftDay(today, -(weekday - 1)))
}

/** The Oslo week that starts on this Monday (a date string; any other day is moved back to its Monday). */
export function osloWeek(monday: string): WeekRange {
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i))
  return {
    start: monday, end: days[6], days,
    startAt: osloMidnight(monday).toISOString(), endAt: osloMidnight(shiftDay(monday, 7)).toISOString(),
    prevStart: shiftDay(monday, -7),
  }
}

/**
 * The week the Monday-morning timer reports on: the week that ended last night, complete (owner-critic, 22.11.2026: a
 * report made on Sunday night missed Sunday's steps, sleep and food). The timer fires at 03:00 and 04:00 UTC on a Monday,
 * which is 04:00 / 05:00 (winter) or 05:00 / 06:00 (summer) in Oslo: only a run that lands from 05:00 to 07:00 Oslo time
 * acts (the earlier winter run is "not the time", a second run in the window finds the report made). Null outside it.
 */
export function scheduledReportWeek(now: Date): WeekRange | null {
  const { hour, weekday } = osloClock(now)
  // A day back from a Monday morning is Sunday of the week that ended, whatever a clock change did to the hours.
  return weekday === 1 && hour >= 5 && hour < 7 ? osloWeekOf(new Date(now.getTime() - 24 * 3_600_000)) : null
}

/** The last complete Oslo week before the one `now` is in. */
export function lastFullWeek(now: Date): WeekRange {
  return osloWeek(shiftDay(osloWeekOf(now).start, -7))
}

/** What the button makes, and for whom. `redo`: the scheduled report of the last full week (missing or failed) is made now. */
export type ManualPlan =
  | { kind: 'redo'; week: WeekRange }
  | { kind: 'copy'; week: WeekRange }
  | { kind: 'so_far'; week: WeekRange }

/**
 * The button's week (owner-critic, 22.11.2026). Last week has no ready scheduled report (not made, or failed): the button
 * makes THAT report, the real one, again. Last week's report is ready: on Monday and Tuesday the button makes a test copy
 * of last week (never replacing the real one), later in the week the week so far.
 */
export function manualReportPlan(now: Date, lastWeekReportReady: boolean): ManualPlan {
  const last = lastFullWeek(now)
  if (!lastWeekReportReady) return { kind: 'redo', week: last }
  return osloClock(now).weekday <= 2 ? { kind: 'copy', week: last } : { kind: 'so_far', week: osloWeekOf(now) }
}

/**
 * Whether a push may go now: from 07:00 to 22:00 Oslo time (owner-critic, 22.11.2026: a report finished at 05:30 is announced
 * at 07:00, not on a sleeping phone).
 */
export function pushWindowOpen(now: Date): boolean {
  const { hour } = osloClock(now)
  return hour >= 7 && hour < 22
}

/** DD.MM.YYYY, the app's one way to write a date. */
export function dmy(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

// ── Small helpers ───────────────────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const obj = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const inWeek = (day: string, week: WeekRange) => day >= week.start && day <= week.end

/** A free text as one short line (control characters and line breaks out), or a fallback. */
export function shortText(value: unknown, max: number, fallback: string): string {
  const line = checkedLine(typeof value === 'string' ? value.slice(0, max * 4) : '', 100_000)
  return line ? [...line].slice(0, max).join('') : fallback
}

// ── Training ────────────────────────────────────────────────────────────────

export interface TrainingRows {
  /** Workouts in the week and the four weeks before it. */
  workouts: Row[]
  exercises: Row[]
  sets: Row[]
  templates: Row[]
  secondaries: Row[]
}

export interface TrainingFacts {
  has_data: boolean
  sessions: { date: string; title: string; working_sets: number; volume_kg: number }[]
  session_count: number
  /** The average number of sessions a week over the four weeks before. Null with none. */
  previous_weeks_avg_sessions: number | null
  working_sets: number
  volume_kg: number
  previous_weeks_avg_volume_kg: number | null
  /** Credited hard sets per muscle (primary 1, secondary 0.5), most first. */
  muscles: { muscle: string; sets: number }[]
  /** The exercises with the most volume: the top set, and how it compares with the best of the weeks before. */
  key_lifts: { exercise: string; top_set: string; top_weight_kg: number; best_before_kg: number | null; change: 'new_best' | 'same' | 'lower' | 'no_history' }[]
}

const isWorking = (set: Row) => str(set.type) !== 'warmup'
const setVolume = (set: Row) => (isWorking(set) ? num(set.weight_kg) * num(set.reps) : 0)

function workoutDay(w: Row): string {
  const at = str(w.start_time) || str(w.hevy_created_at)
  const ms = Date.parse(at)
  return Number.isFinite(ms) ? osloDay(new Date(ms)) : ''
}

export function trainingFacts(rows: TrainingRows, week: WeekRange): TrainingFacts {
  const templateById = new Map(rows.templates.map(t => [str(t.id), t]))
  const secondaryBy = new Map<string, string[]>()
  for (const m of rows.secondaries) {
    const id = str(m.exercise_template_id)
    secondaryBy.set(id, [...(secondaryBy.get(id) ?? []), str(m.muscle_group)])
  }
  const workoutById = new Map(rows.workouts.map(w => [str(w.id), w]))
  const exerciseById = new Map(rows.exercises.map(e => [str(e.id), e]))
  const dayOfWorkout = new Map(rows.workouts.map(w => [str(w.id), workoutDay(w)]))

  const sessions = new Map<string, { date: string; title: string; sets: number; volume: number }>()
  const muscles = new Map<string, number>()
  const perExercise = new Map<string, { title: string; volume: number; top: { weight: number; reps: number } | null; bestBefore: number | null; seenBefore: boolean }>()

  for (const set of rows.sets) {
    const exercise = exerciseById.get(str(set.hevy_exercise_id))
    if (!exercise) continue
    const wid = str(exercise.hevy_workout_id)
    const workout = workoutById.get(wid)
    const day = dayOfWorkout.get(wid) ?? ''
    if (!workout || !day) continue
    const tid = str(exercise.exercise_template_id)
    const template = templateById.get(tid)
    const title = shortText(template?.title, 60, 'Exercise')
    const weight = num(set.weight_kg), reps = num(set.reps)
    if (inWeek(day, week)) {
      const s = sessions.get(wid) ?? { date: day, title: shortText(workout.title, 60, 'Workout'), sets: 0, volume: 0 }
      if (isWorking(set)) s.sets += 1
      s.volume += setVolume(set)
      sessions.set(wid, s)
      if (isWorking(set)) {
        const primary = str(template?.primary_muscle_group)
        if (primary) muscles.set(primary, (muscles.get(primary) ?? 0) + 1)
        for (const m of secondaryBy.get(tid) ?? []) if (m) muscles.set(m, (muscles.get(m) ?? 0) + 0.5)
      }
      const e = perExercise.get(tid) ?? { title, volume: 0, top: null, bestBefore: null, seenBefore: false }
      e.volume += setVolume(set)
      if (isWorking(set) && weight > 0 && reps > 0 && (!e.top || weight > e.top.weight || (weight === e.top.weight && reps > e.top.reps))) e.top = { weight, reps }
      perExercise.set(tid, e)
    }
    // The four weeks before count for "best before" (every earlier set of the same exercise).
    if (day < week.start && isWorking(set) && weight > 0 && reps > 0) {
      const e = perExercise.get(tid) ?? { title, volume: 0, top: null, bestBefore: null, seenBefore: false }
      e.bestBefore = Math.max(e.bestBefore ?? 0, weight)
      e.seenBefore = true
      perExercise.set(tid, e)
    }
  }

  // The four weeks before, for the weekly averages: their sessions, and the volume of their sets.
  const fourBack = shiftDay(week.start, -28)
  const earlier = new Set(rows.workouts.filter(w => { const d = workoutDay(w); return d >= fourBack && d < week.start }).map(w => str(w.id)))
  let prevVolume = 0
  for (const set of rows.sets) {
    const exercise = exerciseById.get(str(set.hevy_exercise_id))
    if (exercise && earlier.has(str(exercise.hevy_workout_id))) prevVolume += setVolume(set)
  }
  const hasPrevious = earlier.size > 0

  const sessionList = [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
  const keyLifts = [...perExercise.values()]
    .filter(e => e.top !== null && e.volume > 0)
    .sort((a, b) => b.volume - a.volume || a.title.localeCompare(b.title))
    .slice(0, 3)
    .map(e => {
      const top = e.top as { weight: number; reps: number }
      const change: TrainingFacts['key_lifts'][number]['change'] = !e.seenBefore ? 'no_history' : top.weight > (e.bestBefore ?? 0) ? 'new_best' : top.weight === e.bestBefore ? 'same' : 'lower'
      return { exercise: e.title, top_set: `${r1(top.weight)} kg × ${top.reps}`, top_weight_kg: r1(top.weight), best_before_kg: e.bestBefore === null ? null : r1(e.bestBefore), change }
    })
  return {
    has_data: sessionList.length > 0,
    sessions: sessionList.map(s => ({ date: dmy(s.date), title: s.title, working_sets: s.sets, volume_kg: Math.round(s.volume) })),
    session_count: sessionList.length,
    previous_weeks_avg_sessions: hasPrevious ? r1(earlier.size / 4) : null,
    working_sets: sessionList.reduce((a, s) => a + s.sets, 0),
    volume_kg: Math.round(sessionList.reduce((a, s) => a + s.volume, 0)),
    previous_weeks_avg_volume_kg: hasPrevious ? Math.round(prevVolume / 4) : null,
    muscles: [...muscles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([muscle, sets]) => ({ muscle: shortText(muscle, 30, 'muscle'), sets: r1(sets) })),
    key_lifts: keyLifts,
  }
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface HealthRows {
  /** `sleep_analysis` rows from two days before the earlier week to the end of the week. */
  sleep: Row[]
  /** Hourly or minute rows of step_count, active_energy and resting_heart_rate for the two weeks. */
  metrics: Row[]
  /** Weight readings (kg) with their instant, from every source, for the two weeks and the days before. */
  weights: { at: string; kg: number }[]
  /** True when a read hit its row limit: the figures are then partial and the report says so. */
  truncated: boolean
}

// The sleep contract, mirrored (see the header).
const SLEEP_CONTAINMENT = 0.9
const SLEEP_MIN_EXTRA_MS = 15 * 60_000

function timeMs(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const iso = s.trim().replace(' ', 'T').replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
  let t = Date.parse(iso)
  if (!Number.isFinite(t)) t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function sleepNightKey(r: Row): string {
  const end = obj(r.value).sleepEnd
  if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(end) && /[+-]\d{2}:?\d{2}$/.test(end.trim())) return end.slice(0, 10)
  return str(r.date)
}

function mergeSleepSessions(pre: Row[]): Row[] {
  const timed: { r: Row; start: number; end: number; total: number; order: number }[] = []
  const untimed: Row[] = []
  const seen = new Set<string>()
  for (const r of pre) {
    const v = obj(r.value)
    const key = [v.sleepStart ?? r.recorded_at, v.sleepEnd ?? '', v.totalSleep ?? ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const start = timeMs(v.sleepStart), end = timeMs(v.sleepEnd)
    if (start !== null && end !== null && end > start) timed.push({ r, start, end, total: num(v.totalSleep), order: timed.length })
    else untimed.push(r)
  }
  const ranked = [...timed].sort((a, b) => (b.total - a.total) || ((b.end - b.start) - (a.end - a.start)) || (a.order - b.order))
  const kept: typeof timed = []
  for (const s of ranked) {
    const dup = kept.some(k => {
      const overlap = Math.min(s.end, k.end) - Math.max(s.start, k.start)
      const span = s.end - s.start
      return overlap > 0 && span > 0 && (overlap / span >= SLEEP_CONTAINMENT || span - overlap < SLEEP_MIN_EXTRA_MS)
    })
    if (!dup) kept.push(s)
  }
  kept.sort((a, b) => a.start - b.start)
  return [...untimed, ...kept.map(k => k.r)]
}

/** One entry per night (the day you woke up): hours asleep. */
export function sleepNights(rows: Row[]): { date: string; hours: number; deep: number }[] {
  const byNight = new Map<string, Row[]>()
  for (const r of rows) byNight.set(sleepNightKey(r), [...(byNight.get(sleepNightKey(r)) ?? []), r])
  const out: { date: string; hours: number; deep: number }[] = []
  for (const [date, pts] of byNight) {
    const manual = pts.filter(p => p.source === 'manual')
    const src = manual.length > 0 ? manual : pts
    const pre = src.filter(p => typeof obj(p.value).totalSleep === 'number')
    let deep = 0, total = 0
    if (pre.length > 0) {
      for (const p of mergeSleepSessions(pre)) {
        const v = obj(p.value)
        deep += num(v.deep)
        total += typeof v.totalSleep === 'number' ? v.totalSleep : num(v.core) + num(v.rem) + num(v.deep)
      }
    } else {
      let core = 0, rem = 0, asleep = 0, awake = 0
      for (const p of src) {
        const v = obj(p.value)
        if (typeof v.qty !== 'number') continue
        if (v.value === 'Core') core += v.qty
        else if (v.value === 'REM') rem += v.qty
        else if (v.value === 'Deep') deep += v.qty
        else if (v.value === 'Awake') awake += v.qty
        else if (v.value === 'Asleep') asleep += v.qty
      }
      total = core + rem + deep + asleep
      if (!(total > 0 || awake > 0)) continue
    }
    out.push({ date, hours: r2(total), deep: r2(deep) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// The hour-level collapse of the Health tab, mirrored from ai-proxy's collapseDuplicateSumPoints.
const SUM_METRICS = new Set(['step_count', 'active_energy'])
const MINUTE_GRAIN_MIN_MINUTES = 7
const isHourBoundary = (recordedAt: string) => recordedAt.slice(14, 19) === '00:00'

export function collapseSumRows(rows: Row[]): Row[] {
  const byHour = new Map<string, Row[]>()
  const passthrough: Row[] = []
  for (const r of rows) {
    if (!SUM_METRICS.has(str(r.metric_name)) || typeof obj(r.value).qty !== 'number') { passthrough.push(r); continue }
    const key = `${r.metric_name}|${str(r.recorded_at).slice(0, 13)}`
    byHour.set(key, [...(byHour.get(key) ?? []), r])
  }
  const kept: Row[] = []
  for (const hourRows of byHour.values()) {
    if (hourRows.length === 1) { kept.push(hourRows[0]); continue }
    const perMinute = new Map<string, Row>()
    for (const r of hourRows) {
      const k = str(r.recorded_at).slice(0, 16)
      const cur = perMinute.get(k)
      if (!cur || num(obj(r.value).qty) > num(obj(cur.value).qty)) perMinute.set(k, r)
    }
    if (perMinute.size >= MINUTE_GRAIN_MIN_MINUTES) { kept.push(...perMinute.values()); continue }
    let winner = hourRows[0]
    for (const r of hourRows.slice(1)) {
      const rb = isHourBoundary(str(r.recorded_at)), wb = isHourBoundary(str(winner.recorded_at))
      if (rb && !wb) winner = r
      else if (rb === wb && num(obj(r.value).qty) > num(obj(winner.value).qty)) winner = r
    }
    kept.push(winner)
  }
  return [...kept, ...passthrough]
}

export interface HealthFacts {
  has_data: boolean
  truncated: boolean
  sleep: { nights: number; avg_hours: number | null; best_hours: number | null; worst_hours: number | null; previous_avg_hours: number | null; under_6h_nights: number } | null
  steps: { days: number; avg_per_day: number | null; best_day: number | null; previous_avg_per_day: number | null } | null
  active_energy: { avg_kcal_per_day: number | null; previous_avg_kcal_per_day: number | null } | null
  resting_heart_rate: { avg_bpm: number | null; previous_avg_bpm: number | null } | null
  weight: { latest_kg: number; change_in_week_kg: number | null; change_since_before_week_kg: number | null } | null
}

function dailySums(rows: Row[], metric: string): Map<string, number> {
  const kept = collapseSumRows(rows.filter(r => r.metric_name === metric))
  const by = new Map<string, number>()
  for (const r of kept) {
    const unit = str(r.unit).toLowerCase()
    const raw = num(obj(r.value).qty)
    const qty = metric === 'active_energy' && unit.includes('kj') ? raw / 4.184 : raw
    by.set(str(r.date), (by.get(str(r.date)) ?? 0) + qty)
  }
  return by
}

export function healthFacts(rows: HealthRows, week: WeekRange): HealthFacts {
  const prevWeekEnd = shiftDay(week.start, -1)
  const nights = sleepNights(rows.sleep)
  const thisNights = nights.filter(n => inWeek(n.date, week))
  const prevNights = nights.filter(n => n.date >= week.prevStart && n.date <= prevWeekEnd)
  const sleep = thisNights.length === 0 ? null : {
    nights: thisNights.length,
    avg_hours: r2(avg(thisNights.map(n => n.hours)) as number),
    best_hours: Math.max(...thisNights.map(n => n.hours)),
    worst_hours: Math.min(...thisNights.map(n => n.hours)),
    previous_avg_hours: prevNights.length ? r2(avg(prevNights.map(n => n.hours)) as number) : null,
    under_6h_nights: thisNights.filter(n => n.hours < 6).length,
  }

  const split = (map: Map<string, number>) => {
    const cur = [...map.entries()].filter(([d, v]) => inWeek(d, week) && v > 0).map(([, v]) => v)
    const prev = [...map.entries()].filter(([d, v]) => d >= week.prevStart && d <= prevWeekEnd && v > 0).map(([, v]) => v)
    return { cur, prev }
  }
  const stepDays = split(dailySums(rows.metrics, 'step_count'))
  const steps = stepDays.cur.length === 0 ? null : {
    days: stepDays.cur.length,
    avg_per_day: Math.round(avg(stepDays.cur) as number),
    best_day: Math.round(Math.max(...stepDays.cur)),
    previous_avg_per_day: stepDays.prev.length ? Math.round(avg(stepDays.prev) as number) : null,
  }
  const energyDays = split(dailySums(rows.metrics, 'active_energy'))
  const active = energyDays.cur.length === 0 ? null : {
    avg_kcal_per_day: Math.round(avg(energyDays.cur) as number),
    previous_avg_kcal_per_day: energyDays.prev.length ? Math.round(avg(energyDays.prev) as number) : null,
  }
  const resting = (from: string, to: string) => rows.metrics
    .filter(r => r.metric_name === 'resting_heart_rate' && str(r.date) >= from && str(r.date) <= to && typeof obj(r.value).qty === 'number')
    .map(r => num(obj(r.value).qty))
  const restNow = resting(week.start, week.end), restPrev = resting(week.prevStart, prevWeekEnd)
  const restingHr = restNow.length === 0 ? null : { avg_bpm: r1(avg(restNow) as number), previous_avg_bpm: restPrev.length ? r1(avg(restPrev) as number) : null }

  // Weight: the newest reading of each day wins; kg only.
  const byDay = new Map<string, { at: string; kg: number }>()
  for (const w of rows.weights) {
    if (!(w.kg > 20 && w.kg < 400)) continue
    const ms = Date.parse(w.at)
    if (!Number.isFinite(ms)) continue
    const day = osloDay(new Date(ms))
    const cur = byDay.get(day)
    if (!cur || w.at > cur.at) byDay.set(day, w)
  }
  const sorted = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const inThisWeek = sorted.filter(([d]) => inWeek(d, week))
  const before = sorted.filter(([d]) => d < week.start)
  const weight = inThisWeek.length === 0 ? null : {
    latest_kg: r1(inThisWeek[inThisWeek.length - 1][1].kg),
    change_in_week_kg: inThisWeek.length > 1 ? r1(inThisWeek[inThisWeek.length - 1][1].kg - inThisWeek[0][1].kg) : null,
    change_since_before_week_kg: before.length ? r1(inThisWeek[inThisWeek.length - 1][1].kg - before[before.length - 1][1].kg) : null,
  }
  return { has_data: !!(sleep || steps || active || restingHr || weight), truncated: rows.truncated, sleep, steps, active_energy: active, resting_heart_rate: restingHr, weight }
}

// ── Food ────────────────────────────────────────────────────────────────────

export interface FoodRows {
  /** Eaten entries of the week: { date, calories, protein_g }. */
  entries: Row[]
  /** Water entries of the week: { date, amount_ml }. */
  water: Row[]
  /** The owner's daily targets row, or null. */
  targets: Row | null
}

export interface FoodFacts {
  has_data: boolean
  days_logged: number
  avg_kcal_on_logged_days: number | null
  avg_protein_g_on_logged_days: number | null
  target_kcal: number | null
  target_protein_g: number | null
  days_within_10pct_of_kcal_target: number | null
  days_protein_target_met: number | null
  avg_water_ml_on_logged_days: number | null
  target_water_ml: number | null
}

export function foodFacts(rows: FoodRows, week: WeekRange): FoodFacts {
  const kcal = new Map<string, number>(), protein = new Map<string, number>()
  for (const e of rows.entries) {
    const d = str(e.date)
    if (!inWeek(d, week)) continue
    kcal.set(d, (kcal.get(d) ?? 0) + num(e.calories))
    protein.set(d, (protein.get(d) ?? 0) + num(e.protein_g))
  }
  const water = new Map<string, number>()
  for (const w of rows.water) if (inWeek(str(w.date), week)) water.set(str(w.date), (water.get(str(w.date)) ?? 0) + num(w.amount_ml))
  const days = [...kcal.keys()].filter(d => (kcal.get(d) ?? 0) > 0)
  const t = rows.targets
  const targetKcal = t ? numOrNull(t.calories) : null, targetProtein = t ? numOrNull(t.protein_g) : null, targetWater = t ? numOrNull(t.water_ml) : null
  const withTarget = (v: number | null) => (v !== null && v > 0 ? v : null)
  const tk = withTarget(targetKcal), tp = withTarget(targetProtein), tw = withTarget(targetWater)
  const waterDays = [...water.entries()].filter(([, v]) => v > 0)
  return {
    has_data: days.length > 0,
    days_logged: days.length,
    avg_kcal_on_logged_days: days.length ? Math.round(avg(days.map(d => kcal.get(d) as number)) as number) : null,
    avg_protein_g_on_logged_days: days.length ? Math.round(avg(days.map(d => protein.get(d) as number)) as number) : null,
    target_kcal: tk, target_protein_g: tp,
    days_within_10pct_of_kcal_target: tk === null ? null : days.filter(d => Math.abs((kcal.get(d) as number) - tk) <= tk * 0.1).length,
    days_protein_target_met: tp === null ? null : days.filter(d => (protein.get(d) as number) >= tp).length,
    avg_water_ml_on_logged_days: waterDays.length ? Math.round(avg(waterDays.map(([, v]) => v)) as number) : null,
    target_water_ml: tw,
  }
}

// ── Tasks and time ──────────────────────────────────────────────────────────

export interface TaskRows {
  /** Tasks closed in the week (completed_at inside it). */
  done: Row[]
  /** Tasks due in the week or earlier that are still open. */
  open: Row[]
  /** How many tasks were created in the week. */
  created: number | null
  /** Time blocks dated in the week. */
  blocks: Row[]
}

export interface TaskFacts {
  has_data: boolean
  done: number
  done_by_area: { area: string; count: number }[]
  slipped: number
  slipped_titles: string[]
  carried_over_open: number
  created: number | null
  scheduled_hours_by_area: { area: string; hours: number }[]
}

const DONE_STATES = new Set(['done', 'cancelled'])

export function taskFacts(rows: TaskRows, week: WeekRange): TaskFacts {
  const doneBy = new Map<string, number>()
  let done = 0
  for (const t of rows.done) {
    const at = Date.parse(str(t.completed_at))
    if (!Number.isFinite(at)) continue
    const day = osloDay(new Date(at))
    if (!inWeek(day, week) || str(t.status) !== 'done') continue
    done += 1
    const area = shortText(t.domain, 30, 'other')
    doneBy.set(area, (doneBy.get(area) ?? 0) + 1)
  }
  const slipped = rows.open.filter(t => !isClosed(t) && inWeek(str(t.due_date), week))
  const carried = rows.open.filter(t => !isClosed(t) && str(t.due_date) !== '' && str(t.due_date) < week.start)
  const hours = new Map<string, number>()
  for (const b of rows.blocks) {
    if (!inWeek(str(b.date), week) || b.busy === false) continue
    const linked = obj(b.task)
    if (str(linked.status) === 'cancelled') continue
    const area = shortText(b.category, 30, 'other')
    hours.set(area, (hours.get(area) ?? 0) + num(b.duration_minutes) / 60)
  }
  return {
    has_data: done > 0 || slipped.length > 0 || hours.size > 0,
    done,
    done_by_area: [...doneBy.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([area, count]) => ({ area, count })),
    slipped: slipped.length,
    slipped_titles: slipped.slice(0, 5).map(t => shortText(t.title, 60, 'Task')),
    carried_over_open: carried.length,
    created: rows.created,
    scheduled_hours_by_area: [...hours.entries()].filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([area, h]) => ({ area, hours: r1(h) })),
  }
}
// A closed task is one that is done or cancelled; an open one is neither.
function isClosed(t: Row): boolean { return DONE_STATES.has(str(t.status)) }

// ── The whole week, and the text the model reads ────────────────────────────

export interface WeekFacts {
  week_start: string
  week_end: string
  /** True when the week is not over yet (the button made it in the middle of the week). */
  partial: boolean
  training: TrainingFacts | null
  health: HealthFacts | null
  food: FoodFacts | null
  tasks: TaskFacts | null
  /** The sections whose database read failed: said as such in the text, never passed off as "no data". */
  unreadable: string[]
}

export function hasAnyData(f: WeekFacts): boolean {
  return !!(f.training?.has_data || f.health?.has_data || f.food?.has_data || f.tasks?.has_data)
}

const n = (v: number | null, unit = '') => (v === null ? 'unknown' : `${grp(v)}${unit}`)
const text = (s: string) => escapeTagText(s)

// ── How the figures are written for the model ───────────────────────────────
// Code computes every difference and every duration (owner-critic, 22.11.2026): a model that is asked to subtract or to
// turn 6.79 hours into hours and minutes does it wrong now and then. The text carries "+3 286 steps a day, +55 %" and
// "6 h 47 min"; the instructions tell the model to copy them.

/** An integer with a space between thousands: 9286 → "9 286". */
export function grp(value: number): string {
  const rounded = Math.round(value * 10) / 10
  const [whole, frac] = String(Math.abs(rounded)).split('.')
  return `${rounded < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${frac ? `.${frac}` : ''}`
}

/** Hours as "6 h 47 min", "7 h", "47 min". */
export function dur(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60)
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}

/** A signed difference of two durations in hours: "+12 min", "-1 h 5 min", or "no change". */
export function sdur(diffHours: number): string {
  const total = Math.round(Math.abs(diffHours) * 60)
  return total === 0 ? 'no change' : `${diffHours < 0 ? '-' : '+'}${dur(diffHours)}`
}

/** A signed number: "+3 286", "-0.5", or "no change". */
export function sgn(diff: number, unit = ''): string {
  const r = Math.round(diff * 10) / 10
  return r === 0 ? 'no change' : `${r < 0 ? '-' : '+'}${grp(Math.abs(r))}${unit}`
}

/** The change in percent against the week before: "+55 %", "-12 %", "no change"; null when the week before was zero or unknown. */
export function pctChange(cur: number, prev: number | null): string | null {
  if (prev === null || prev <= 0) return null
  const p = Math.round(((cur - prev) / prev) * 100)
  return p === 0 ? 'no change' : `${p < 0 ? '-' : '+'}${Math.abs(p)} %`
}

/** " (the week before: X; change: +A, +P %)" or nothing. `show` writes a value, `diff` writes the signed difference. */
function against(cur: number | null, prev: number | null, show: (v: number) => string, diff: (d: number) => string): string {
  if (cur === null || prev === null) return ''
  const d = diff(cur - prev)
  const p = pctChange(cur, prev)
  return ` (the week before: ${show(prev)}; change: ${d}${p && d !== 'no change' ? `, ${p}` : ''})`
}

export function factsText(f: WeekFacts): string {
  const out: string[] = [`<week>${dmy(f.week_start)} to ${dmy(f.week_end)}${f.partial ? ' (the week is not over yet)' : ''}</week>`]
  const section = (name: string, lines: string[] | null) => {
    out.push(`<${name}>`, ...(f.unreadable.includes(name) ? ['COULD NOT BE READ (a database error)'] : lines === null ? ['NO DATA THIS WEEK'] : lines), `</${name}>`)
  }
  const t = f.training
  section('training', !t || !t.has_data ? null : [
    `Sessions: ${t.session_count}${against(t.session_count, t.previous_weeks_avg_sessions, v => `${v} a week on average`, d => sgn(d))}`,
    `Working sets: ${t.working_sets}; volume ${grp(t.volume_kg)} kg${against(t.volume_kg, t.previous_weeks_avg_volume_kg, v => `${grp(v)} kg a week on average`, d => sgn(d, ' kg'))}`,
    ...t.sessions.map(s => `Session ${s.date}: ${text(s.title)}, ${s.working_sets} working sets, ${grp(s.volume_kg)} kg`),
    ...(t.muscles.length ? [`Credited sets per muscle: ${t.muscles.map(m => `${text(m.muscle)} ${m.sets}`).join(', ')}`] : []),
    ...t.key_lifts.map(l => `Key lift ${text(l.exercise)}: top set ${l.top_set}; ${l.change === 'no_history' ? 'no earlier weeks to compare' : l.change === 'new_best' ? `a new best (before: ${n(l.best_before_kg, ' kg')}; change: ${sgn(l.top_weight_kg - (l.best_before_kg ?? 0), ' kg')})` : l.change === 'same' ? 'the same as the best before' : `below the best before (${n(l.best_before_kg, ' kg')}; change: ${sgn(l.top_weight_kg - (l.best_before_kg ?? 0), ' kg')})`}`),
  ])
  const h = f.health
  section('health', !h || !h.has_data ? null : [
    ...(h.truncated ? ['Note: some readings could not be read in full, so these figures may be partial.'] : []),
    h.sleep ? `Sleep: ${h.sleep.nights} nights recorded, average ${dur(h.sleep.avg_hours as number)}, best ${dur(h.sleep.best_hours as number)}, worst ${dur(h.sleep.worst_hours as number)}, ${h.sleep.under_6h_nights} under 6 h${against(h.sleep.avg_hours, h.sleep.previous_avg_hours, dur, sdur)}` : 'Sleep: no nights recorded',
    h.steps ? `Steps: average ${grp(h.steps.avg_per_day as number)} a day over ${h.steps.days} days, best day ${grp(h.steps.best_day as number)}${against(h.steps.avg_per_day, h.steps.previous_avg_per_day, v => `${grp(v)} a day`, d => sgn(d, ' steps a day'))}` : 'Steps: no data',
    h.active_energy ? `Active energy: average ${grp(h.active_energy.avg_kcal_per_day as number)} kcal a day${against(h.active_energy.avg_kcal_per_day, h.active_energy.previous_avg_kcal_per_day, v => `${grp(v)} kcal a day`, d => sgn(d, ' kcal a day'))}` : 'Active energy: no data',
    h.resting_heart_rate ? `Resting heart rate: average ${h.resting_heart_rate.avg_bpm} bpm${against(h.resting_heart_rate.avg_bpm, h.resting_heart_rate.previous_avg_bpm, v => `${v} bpm`, d => sgn(d, ' bpm'))}` : 'Resting heart rate: no data',
    h.weight ? `Weight: ${h.weight.latest_kg} kg at the last weigh-in; ${h.weight.change_in_week_kg === null ? 'one weigh-in this week' : `${sgn(h.weight.change_in_week_kg, ' kg')} within the week`}; ${h.weight.change_since_before_week_kg === null ? 'no earlier weigh-in to compare' : `${sgn(h.weight.change_since_before_week_kg, ' kg')} since before the week`}` : 'Weight: no weigh-in this week',
  ])
  const fd = f.food
  const vsTarget = (cur: number | null, target: number | null, unit: string) =>
    cur === null || target === null ? '' : ` (against the target: ${sgn(cur - target, unit)}${pctChange(cur, target) && cur !== target ? `, ${pctChange(cur, target)}` : ''})`
  section('food', !fd || !fd.has_data ? null : [
    `Days with food logged: ${fd.days_logged} of 7`,
    `Average on logged days: ${n(fd.avg_kcal_on_logged_days, ' kcal')}${vsTarget(fd.avg_kcal_on_logged_days, fd.target_kcal, ' kcal')}, ${n(fd.avg_protein_g_on_logged_days, ' g')} protein${vsTarget(fd.avg_protein_g_on_logged_days, fd.target_protein_g, ' g')}`,
    `Targets: ${n(fd.target_kcal, ' kcal')}, ${n(fd.target_protein_g, ' g')} protein, ${n(fd.target_water_ml, ' ml')} water`,
    `Days within 10% of the calorie target: ${n(fd.days_within_10pct_of_kcal_target)}; days the protein target was met: ${n(fd.days_protein_target_met)}`,
    `Water: average ${n(fd.avg_water_ml_on_logged_days, ' ml')} on days with water logged${vsTarget(fd.avg_water_ml_on_logged_days, fd.target_water_ml, ' ml')}`,
  ])
  const k = f.tasks
  section('tasks', !k || !k.has_data ? null : [
    `Tasks done: ${k.done}${k.done_by_area.length ? ` (${k.done_by_area.map(a => `${text(a.area)} ${a.count}`).join(', ')})` : ''}`,
    `Slipped (due this week, still open): ${k.slipped}${k.slipped_titles.length ? `: ${k.slipped_titles.map(x => `"${text(x)}"`).join(', ')}` : ''}`,
    `Older tasks still open: ${k.carried_over_open}; tasks created this week: ${n(k.created)}`,
    k.scheduled_hours_by_area.length ? `Scheduled time per area: ${k.scheduled_hours_by_area.map(a => `${text(a.area)} ${dur(a.hours)}`).join(', ')}` : 'Scheduled time per area: none',
  ])
  return out.join('\n')
}
