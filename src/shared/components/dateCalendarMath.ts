// The month calendar's date maths (DateCalendar). Pure, no React.
// Checked by scripts/verify-date-calendar.cjs.
//
// A view is one month: { year, month } with month 0–11. Days are yyyy-MM-dd
// strings, min/max are yyyy-MM-dd too, and a month is pickable when at least
// one of its days lies inside min–max.

export interface MonthView { year: number; month: number }

export interface DayCell { date: string; day: number; inMonth: boolean }

/** Short month names for the month grid ("a month heading may name the month"). */
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Years the year list offers when no min/max bounds it. */
export const FIRST_YEAR = 1900
export const YEARS_AHEAD = 30

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** yyyy-MM of a view. */
export const monthKey = (v: MonthView) => `${v.year}-${pad(v.month + 1)}`

/** Monday-first weeks covering `month` (0-based) of `year`, incl. the neighbouring days. */
export function monthCells(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1, 12)
  const cursor = new Date(year, month, 1 - ((first.getDay() + 6) % 7), 12)
  const cells: DayCell[] = []
  do {
    for (let i = 0; i < 7; i++) {
      cells.push({ date: ymd(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month })
      cursor.setDate(cursor.getDate() + 1)
    }
  } while (cursor.getMonth() === month)
  return cells
}

/** The month first shown: the value's, else today's — pulled inside min–max. */
export function startView(value: string, min: string | undefined, max: string | undefined, today: string): MonthView {
  const start = value || (max && max < today ? max : min && min > today ? min : today)
  return { year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 }
}

/** The view `delta` months away (negative = back). */
export function shiftMonth(v: MonthView, delta: number): MonthView {
  const t = v.year * 12 + v.month + delta
  return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 }
}

/** True when the month holds at least one day inside min–max. */
export function monthAllowed(year: number, month: number, min?: string, max?: string): boolean {
  const key = monthKey({ year, month })
  return (!min || min.slice(0, 7) <= key) && (!max || max.slice(0, 7) >= key)
}

/** True when the year holds at least one day inside min–max. */
export function yearAllowed(year: number, min?: string, max?: string): boolean {
  return (!min || Number(min.slice(0, 4)) <= year) && (!max || Number(max.slice(0, 4)) >= year)
}

/**
 * Whether the arrows may step `delta` months: never onto a month with
 * nothing pickable (a view already outside min–max may still step back in).
 */
export function canShift(v: MonthView, delta: number, min?: string, max?: string): boolean {
  const key = monthKey(shiftMonth(v, delta))
  return delta < 0 ? !min || min.slice(0, 7) <= key : !max || max.slice(0, 7) >= key
}

/**
 * The same month in another year; when that month has nothing pickable, the
 * nearest month of that year that has.
 */
export function moveToYear(v: MonthView, year: number, min?: string, max?: string): MonthView {
  if (monthAllowed(year, v.month, min, max)) return { year, month: v.month }
  for (let d = 1; d < 12; d++) {
    for (const m of [v.month - d, v.month + d]) {
      if (m >= 0 && m <= 11 && monthAllowed(year, m, min, max)) return { year, month: m }
    }
  }
  return { year, month: v.month }
}

/**
 * The years the year list offers, oldest first: min's year to max's year;
 * without a bound, from 1900 back to the view's year if older, and up to 30
 * years after today (or the view's year if later).
 */
export function yearRange(viewYear: number, todayYear: number, min?: string, max?: string): number[] {
  const from = min ? Number(min.slice(0, 4)) : Math.min(FIRST_YEAR, viewYear)
  const to = max ? Number(max.slice(0, 4)) : Math.max(todayYear + YEARS_AHEAD, viewYear)
  const out: number[] = []
  for (let y = from; y <= to; y++) out.push(y)
  return out
}

/**
 * The year a key moves to in the year list (keyboard): ↑/↓ one year,
 * Page Up/Down ten, Home/End the first/last; kept inside `years`. Null = not
 * a key the list handles.
 */
export function yearForKey(years: number[], year: number, key: string): number | null {
  if (years.length === 0) return null
  const first = years[0]
  const last = years[years.length - 1]
  const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }
  if (key === 'Home') return first
  if (key === 'End') return last
  if (!(key in step)) return null
  return Math.min(last, Math.max(first, year + step[key]))
}
