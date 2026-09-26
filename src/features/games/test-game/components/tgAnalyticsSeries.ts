// Time and rating series for the Analytics screen's two column charts.
// Pure: `today` (local midnight, ms) is passed in, never read from the clock.

import { starsFromRating, type TgGame } from '../testGameModel'
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
  unit: 'month' | 'day'
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

/**
 * Completions per month (per day for the 30-day window). All time plots the
 * last 24 months and counts what is older, so the chart never implies that
 * nothing was finished before it starts.
 */
export function completionSeries(games: TgGame[], period: TgaWindow, today: number): TgaCompletions {
  const now = new Date(today)
  const columns: TgaColumn[] = []
  const index = new Map<string, TgaColumn>()
  const unit: 'month' | 'day' = period === '30d' ? 'day' : 'month'

  if (unit === 'day') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = `${monthKey(d.getFullYear(), d.getMonth())}-${String(d.getDate()).padStart(2, '0')}`
      columns.push({ key, tick: String(d.getDate()), group: MONTH[d.getMonth()], full: `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`, count: 0 })
    }
  } else {
    const months = period === 'all' ? 24 : period === '12m' ? 12 : now.getMonth() + 1
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const y = d.getFullYear(), m = d.getMonth()
      columns.push({ key: monthKey(y, m), tick: MONTH[m], group: String(y), full: `${MONTH_LONG[m]} ${y}`, count: 0 })
    }
  }
  for (const c of columns) index.set(c.key, c)

  const first = unit === 'day' ? windowStart('30d', today)! : new Date(now.getFullYear(), now.getMonth() - (columns.length - 1), 1).getTime()
  const end = windowEnd(today)
  let total = 0, earlier = 0, undated = 0, future = 0
  for (const g of games) {
    // Only what the Completed tile counts (`isCompletion`): status Completed.
    if (!isCompletion(g, null)) continue
    const t = g.finished_at ? Date.parse(g.finished_at) : NaN
    if (!Number.isFinite(t)) { undated++; continue }
    if (t >= end) { future++; continue }
    if (t < first) { if (period === 'all') earlier++; continue }
    const d = new Date(t)
    const key = unit === 'day'
      ? `${monthKey(d.getFullYear(), d.getMonth())}-${String(d.getDate()).padStart(2, '0')}`
      : monthKey(d.getFullYear(), d.getMonth())
    const col = index.get(key)
    if (col) { col.count++; total++ }
  }
  return { columns, unit, total, earlier, undated, future }
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
