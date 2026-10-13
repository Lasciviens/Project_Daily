// Pure numbers for Food · Today's "Last N days" card (7 / 14 / 28 days):
// one entry per day, the averages, how often the targets landed, the best and
// the hardest day, weekdays vs weekends and the logging gaps. The words for
// them are in nutritionStats.ts. Verified by scripts/verify-weekly-nutrition.cjs.
//
// Which days count: a day with no calories is a gap, not a 0 kcal day; a day
// logged under the goal report's half-logged cutoff (60 % of the calorie
// target, at least 800 kcal) is drawn but left out of the averages — a
// forgotten dinner, not a real 900 kcal day. Same rule as Health → Goal.
import { halfLoggedCutoff } from '../health/goal/energyBalance'

export type PeriodDays = 7 | 14 | 28
export const PERIOD_DAYS: readonly PeriodDays[] = [7, 14, 28]

/** Calories within this share of the target count as "on target". */
export const ON_TARGET_SHARE = 0.1

export interface WeekRow {
  date: string; calories: number | null; protein_g: number | null
  carbs_g?: number | null; fat_g?: number | null; sugar_g?: number | null; fiber_g?: number | null
}

export interface Macros { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number }

/** logged: any calories that day. half: logged under the cutoff (left out of averages). */
export interface PeriodDay extends Macros {
  date: string
  weekend: boolean
  logged: boolean
  half: boolean
}

export interface PeriodSummary {
  from: string
  to: string
  period: PeriodDays
  /** Oldest → newest, always `period` long. */
  days: PeriodDay[]
  /** Days with any calories. */
  loggedDays: number
  /** The days the averages use: logged and not half-logged (all logged days when every one is half). */
  counted: PeriodDay[]
  halfCutoff: number
  /** Per counted day, rounded; null when nothing is logged. */
  avg: Macros | null
  proteinHitDays: number
  /** Mean grams short on the counted days that missed the protein target. */
  proteinShortG: number | null
  kcalOnTargetDays: number
  kcalOverDays: number
  kcalUnderDays: number
  /** Closest to both targets / furthest from them (≥ 3 counted days, never the same day). */
  best: PeriodDay | null
  hardest: PeriodDay | null
  /** Mean kcal on counted weekend days vs weekdays (≥ 1 weekend day and ≥ 2 weekdays). */
  weekend: { weekendKcal: number; weekdayKcal: number; gap: number } | null
  /** Unlogged dates, oldest first. */
  gaps: string[]
  /** Half-logged dates, oldest first. */
  halfDays: string[]
}

/** yyyy-MM-dd shifted by n days, calendar-safe (no timezone involved). */
export function shiftDay(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function isWeekend(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 || w === 6
}

/**
 * The window's last day: the viewed day when it is already over, else
 * yesterday — today is still being logged, and a half day drags every
 * average down.
 */
export function periodEnd(viewed: string, today: string): string {
  return viewed < today ? viewed : shiftDay(today, -1)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** How far a day is from both targets (0 = spot on): the calorie miss either way plus any protein shortfall. */
function distance(d: Macros, t: { calories: number; protein: number }): number {
  const k = t.calories > 0 ? Math.abs(d.kcal - t.calories) / t.calories : 0
  const p = t.protein > 0 ? Math.max(0, t.protein - d.protein) / t.protein : 0
  return k + p
}

export function summarizePeriod(rows: WeekRow[], endDate: string, period: PeriodDays, targets: { calories: number; protein: number }): PeriodSummary {
  const from = shiftDay(endDate, -(period - 1))
  const byDate = new Map<string, Macros>()
  for (const r of rows) {
    if (r.date < from || r.date > endDate) continue
    const cur = byDate.get(r.date) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }
    cur.kcal += r.calories ?? 0
    cur.protein += r.protein_g ?? 0
    cur.carbs += r.carbs_g ?? 0
    cur.fat += r.fat_g ?? 0
    cur.fiber += r.fiber_g ?? 0
    cur.sugar += r.sugar_g ?? 0
    byDate.set(r.date, cur)
  }
  const halfCutoff = halfLoggedCutoff(targets.calories)
  const days: PeriodDay[] = []
  for (let i = period - 1; i >= 0; i--) {
    const date = shiftDay(endDate, -i)
    const v = byDate.get(date)
    const kcal = Math.round(v?.kcal ?? 0)
    const logged = kcal > 0
    days.push({
      date, weekend: isWeekend(date), logged, half: logged && kcal < halfCutoff,
      kcal, protein: Math.round(v?.protein ?? 0), carbs: Math.round(v?.carbs ?? 0),
      fat: Math.round(v?.fat ?? 0), fiber: Math.round(v?.fiber ?? 0), sugar: Math.round(v?.sugar ?? 0),
    })
  }
  const logged = days.filter(d => d.logged)
  const full = logged.filter(d => !d.half)
  const counted = full.length ? full : logged
  const avgOf = (f: (d: PeriodDay) => number) => Math.round(mean(counted.map(f)))
  const avg = counted.length
    ? { kcal: avgOf(d => d.kcal), protein: avgOf(d => d.protein), carbs: avgOf(d => d.carbs), fat: avgOf(d => d.fat), fiber: avgOf(d => d.fiber), sugar: avgOf(d => d.sugar) }
    : null

  const T = targets
  const missed = T.protein > 0 ? counted.filter(d => d.protein < T.protein) : []
  const band = T.calories * ON_TARGET_SHARE
  const ranked = counted.length >= 3 ? [...counted].sort((a, b) => distance(a, T) - distance(b, T) || b.date.localeCompare(a.date)) : []
  const best = ranked[0] ?? null
  const hardest = ranked.length ? ranked[ranked.length - 1] : null

  const we = counted.filter(d => d.weekend), wd = counted.filter(d => !d.weekend)
  const weekend = we.length >= 1 && wd.length >= 2
    ? { weekendKcal: Math.round(mean(we.map(d => d.kcal))), weekdayKcal: Math.round(mean(wd.map(d => d.kcal))), gap: Math.round(mean(we.map(d => d.kcal)) - mean(wd.map(d => d.kcal))) }
    : null

  return {
    from, to: endDate, period, days,
    loggedDays: logged.length,
    counted, halfCutoff, avg,
    proteinHitDays: T.protein > 0 ? counted.length - missed.length : 0,
    proteinShortG: missed.length ? Math.round(mean(missed.map(d => T.protein - d.protein))) : null,
    kcalOnTargetDays: T.calories > 0 ? counted.filter(d => Math.abs(d.kcal - T.calories) <= band).length : 0,
    kcalOverDays: T.calories > 0 ? counted.filter(d => d.kcal - T.calories > band).length : 0,
    kcalUnderDays: T.calories > 0 ? counted.filter(d => T.calories - d.kcal > band).length : 0,
    best: best && hardest && best.date !== hardest.date ? best : null,
    hardest: best && hardest && best.date !== hardest.date ? hardest : null,
    weekend,
    gaps: days.filter(d => !d.logged).map(d => d.date),
    halfDays: days.filter(d => d.half).map(d => d.date),
  }
}
