// Time and rating series for the Analytics screen's two column charts.
// Pure: `today` (local midnight, ms) is passed in, never read from the clock.

import { isRealSession } from '../../gameStats'
import { lastPlayedIso, playSeconds, starsFromRating, type TgGame } from '../testGameModel'
import { isCompletion, type TgaWindow, windowEnd, windowStart } from './tgAnalyticsModel'

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface TgaColumn {
  key: string
  /** Axis tick ('' leaves the tick blank). */
  tick: string
  /** A second axis line — the year under months, the month under days — shown where it changes. */
  group?: string
  /** Tooltip and table heading — "September 2026", "12 Sep 2026", "4.5 stars". */
  full: string
  count: number
}

export interface TgaCompletions {
  columns: TgaColumn[]
  unit: TgaUnit
  /** Completions inside the plotted range. */
  total: number
  /** Dated completions older than the plotted range (all time only). */
  earlier: number
  /** Completed games with no finish date at all — they cannot be placed on a timeline. */
  undated: number
  /** Completed games whose finish date is after today (a typo, or a clock) — in no column. */
  future: number
}

const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`
const dayKey = (d: Date) => `${monthKey(d.getFullYear(), d.getMonth())}-${String(d.getDate()).padStart(2, '0')}`
/** Local midnight of the Monday on or before `t`. */
const mondayOf = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) }

export type TgaUnit = 'month' | 'week' | 'day'

/** A window's empty timeline: the columns, the first instant plotted, and the column a date falls in. */
export interface TgaTimeline {
  columns: TgaColumn[]
  unit: TgaUnit
  /** The first instant plotted (ms); older dates are "earlier". */
  first: number
  /** The column key a timestamp belongs to (it may not be one of the columns). */
  keyOf: (t: number) => string
}

/**
 * The columns for a window: days for 7 and 30 days, weeks (Monday first) for
 * 90 days, months otherwise — all time plots the last 24 months. The first
 * instant is the window's own start (windowStart), so a chart's total always
 * equals what the window's tiles count; the 90-day chart's first week is
 * clipped to it.
 */
export function buildTimeline(period: TgaWindow, today: number): TgaTimeline {
  const now = new Date(today)
  const columns: TgaColumn[] = []
  const col = (key: string, tick: string, group: string, full: string) => columns.push({ key, tick, group, full, count: 0 })

  if (period === '7d' || period === '30d') {
    const days = period === '7d' ? 7 : 30
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      col(dayKey(d), String(d.getDate()), MONTH[d.getMonth()], `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`)
    }
    return { columns, unit: 'day', first: windowStart(period, today)!, keyOf: t => dayKey(new Date(t)) }
  }
  if (period === '90d') {
    const first = windowStart('90d', today)!
    const firstDay = new Date(first)
    for (let d = mondayOf(first); d.getTime() <= today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
      const from = d.getTime() < first ? firstDay : d
      col(dayKey(d), String(d.getDate()), MONTH[d.getMonth()], `Week of ${from.getDate()} ${MONTH[from.getMonth()]} ${from.getFullYear()}`)
    }
    return { columns, unit: 'week', first, keyOf: t => dayKey(mondayOf(t)) }
  }
  const months = period === 'all' ? 24 : period === '12m' ? 12 : now.getMonth() + 1
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear(), m = d.getMonth()
    col(monthKey(y, m), MONTH[m], String(y), `${MONTH_LONG[m]} ${y}`)
  }
  const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).getTime()
  return { columns, unit: 'month', first, keyOf: t => { const d = new Date(t); return monthKey(d.getFullYear(), d.getMonth()) } }
}

/**
 * Completions per day, week or month (see buildTimeline). All time plots the
 * last 24 months and counts what is older, so the chart never implies that
 * nothing was finished before it starts.
 */
export function completionSeries(games: TgGame[], period: TgaWindow, today: number): TgaCompletions {
  const { columns, unit, first, keyOf } = buildTimeline(period, today)
  const index = new Map(columns.map(c => [c.key, c]))
  const end = windowEnd(today)
  let total = 0, earlier = 0, undated = 0, future = 0
  for (const g of games) {
    // Only what the Completed tile counts (`isCompletion`): status Completed.
    if (!isCompletion(g, null)) continue
    const t = g.finished_at ? Date.parse(g.finished_at) : NaN
    if (!Number.isFinite(t)) { undated++; continue }
    if (t >= end) { future++; continue }
    if (t < first) { if (period === 'all') earlier++; continue }
    const c = index.get(keyOf(t))
    if (c) { c.count++; total++ }
  }
  return { columns, unit, total, earlier, undated, future }
}

export type TgaLib = 'retro' | 'steam' | 'playstation'
export const TGA_LIBS: TgaLib[] = ['retro', 'steam', 'playstation']

export interface TgaActivityColumn extends TgaColumn {
  /** Games whose LATEST session falls in this column, per library (they sum to `count`). */
  parts: Record<TgaLib, number>
  /** Completions (isCompletion) with a finish date in this column. */
  completed: number
}

export interface TgaActivity {
  columns: TgaActivityColumn[]
  unit: TgaUnit
  /** Games placed on the chart (each once, at its latest session). */
  total: number
  /** Latest sessions older than the plotted range (all time only). */
  earlier: number
  completed: number
  /** The libraries that appear on the chart, in stacking order. */
  libraries: TgaLib[]
}

/**
 * Activity: every played game once, at the date of its latest session — the
 * only session date any provider reports — stacked by library, with the
 * window's completions alongside. A launch shorter than five minutes (checking
 * that a ROM boots) is not play, the same rule as Recently played.
 */
export function activitySeries(games: TgGame[], period: TgaWindow, today: number): TgaActivity {
  const timeline = buildTimeline(period, today)
  const end = windowEnd(today)
  const columns: TgaActivityColumn[] = timeline.columns.map(c => ({ ...c, parts: { retro: 0, steam: 0, playstation: 0 }, completed: 0 }))
  const index = new Map(columns.map(c => [c.key, c]))
  const seen = new Set<TgaLib>()
  let total = 0, earlier = 0, completed = 0
  for (const g of games) {
    const lib: TgaLib = g.library === 'steam' || g.library === 'playstation' ? g.library : 'retro'
    const last = lastPlayedIso(g)
    const t = last ? Date.parse(last) : NaN
    if (Number.isFinite(t) && t < end && isRealSession(playSeconds(g))) {
      if (t < timeline.first) { if (period === 'all') earlier++ }
      else {
        const c = index.get(timeline.keyOf(t))
        if (c) { c.parts[lib]++; c.count++; total++; seen.add(lib) }
      }
    }
    if (isCompletion(g, timeline.first, end)) {
      const c = index.get(timeline.keyOf(Date.parse(g.finished_at!)))
      if (c) { c.completed++; completed++ }
    }
  }
  return { columns, unit: timeline.unit, total, earlier, completed, libraries: TGA_LIBS.filter(l => seen.has(l)) }
}

/**
 * Personal ratings in half-star steps. A rating between steps (a legacy 9.5 is
 * 4.75 stars) counts in the step below — never rounded up into a rating
 * nobody gave. A zero column appears only when a zero rating exists.
 */
export function ratingSeries(games: TgGame[]): { columns: TgaColumn[]; rated: number; median: number | null } {
  const steps = Array.from({ length: 11 }, (_, i) => i / 2)
  const counts = new Map<number, number>(steps.map(s => [s, 0]))
  const all: number[] = []
  for (const g of games) {
    const stars = starsFromRating(g.rating)
    if (stars == null) continue
    all.push(stars)
    const step = Math.floor(stars * 2) / 2
    counts.set(step, (counts.get(step) ?? 0) + 1)
  }
  all.sort((a, b) => a - b)
  const mid = all.length >> 1
  const median = all.length ? (all.length % 2 ? all[mid] : (all[mid - 1] + all[mid]) / 2) : null
  const columns = steps
    .filter(s => s > 0 || (counts.get(0) ?? 0) > 0)
    .map(s => ({
      key: String(s),
      tick: Number.isInteger(s) ? `${s}★` : '',
      full: `${s === 1 ? '1 star' : `${s} stars`}`,
      count: counts.get(s) ?? 0,
    }))
  return { columns, rated: all.length, median }
}

/** Room one axis label needs, in px — a three-letter month at 11px plus air. */
const TICK_ROOM = 34

/**
 * Which columns carry an axis label at this plot width, and what each says.
 * Counted back from the newest column so the current month is always
 * labelled; the second line (year or month) appears on the first label and
 * wherever it changes, so "Jan" is never ambiguous about its year.
 */
export function axisTicks(columns: TgaColumn[], plotWidth: number, all: boolean): Map<string, { line1: string; line2?: string }> {
  const n = columns.length
  const step = all ? 1 : Math.max(1, Math.ceil((n * TICK_ROOM) / Math.max(TICK_ROOM, plotWidth)))
  const out = new Map<string, { line1: string; line2?: string }>()
  let lastGroup: string | undefined
  columns.forEach((c, i) => {
    if (!c.tick || (n - 1 - i) % step !== 0) return
    const line2 = c.group && c.group !== lastGroup ? c.group : undefined
    lastGroup = c.group ?? lastGroup
    out.set(c.key, { line1: c.tick, line2 })
  })
  return out
}
