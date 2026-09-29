// Date labels and the "last night" rule for the Health page. PURE and
// import-free on purpose: scripts/verify-health-date-labels.cjs loads it
// through sucrase.
//
// Dates are local calendar days as 'yyyy-MM-dd' strings. The weekday is
// computed on a UTC midnight purely as a day counter, so no timezone or DST
// shift can move a date. Visible dates are DD.MM.YYYY (owner rule, see
// shared/utils/dateFormat.ts); only chart ticks drop the year.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Parts { y: number; m: number; d: number }

function parts(date: string): Parts {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

function weekday(date: string): string {
  const { y, m, d } = parts(date)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// ── The period navigator ─────────────────────────────────────────────────────

/** One day in the navigator: "Sun 27.09.2026". */
export function dayNavLabel(date: string, _today?: string): string {
  return `${weekday(date)} ${numericDay(date, true)}`
}

/**
 * A window [from, to] as dates only — no "Last 7 days" prefix, the period
 * control already says that: "21.09.2026 – 27.09.2026"; one day falls back to
 * the day label.
 */
export function spanLabel(from: string, to: string, today: string): string {
  if (from === to) return dayNavLabel(to, today)
  return `${numericDay(from, true)} – ${numericDay(to, true)}`
}

// ── The page's date bar (numeric) ───────────────────────────────────────────
// The owner's own format for the bar under the Health tabs (it overrides the
// general en-GB "27 Sep" style there only): day.month with zero padding —
// "21.09 – 27.09" — and the year on BOTH ends when either end is outside the
// current year ("30.12.2025 – 05.01.2026"). A single day is "27.09".

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** "27.09", or "27.09.2025" with the year. */
export function numericDay(date: string, withYear: boolean): string {
  const { y, m, d } = parts(date)
  return `${pad2(d)}.${pad2(m)}${withYear ? `.${y}` : ''}`
}

/** A window [from, to] for the date bar: "21.09 – 27.09", "30.12.2025 –
 *  05.01.2026", or "27.09" for one day ("27.09.2025" in another year). */
export function numericSpanLabel(from: string, to: string, today: string): string {
  const thisYear = parts(today).y
  const withYear = parts(from).y !== thisYear || parts(to).y !== thisYear
  if (from === to) return numericDay(to, withYear)
  return `${numericDay(from, withYear)} – ${numericDay(to, withYear)}`
}

/** The longest label numericSpanLabel can produce ("30.12.2025 – 05.01.2026"),
 *  for sizing the bar's fixed-width date box. */
export const NUMERIC_SPAN_MAX_CHARS = 23

// ── Weekly bars ──────────────────────────────────────────────────────────────

/**
 * A Monday–Sunday week, so a weekly bar says which seven days it counts
 * instead of reading like a single date. Without `today` it is the short
 * chart-tick form "07.07–13.07"; with `today` (tooltips) the full range
 * "07.07.2026 – 13.07.2026".
 */
export function weekRangeLabel(weekStart: string, today?: string): string {
  const end = addDays(weekStart, 6)
  if (today) return `${numericDay(weekStart, true)} – ${numericDay(end, true)}`
  return `${numericDay(weekStart, false)}–${numericDay(end, false)}`
}

// ── Last night ───────────────────────────────────────────────────────────────

/**
 * The night that ENDED on `day` — nights are filed under the morning you woke
 * up, so the Health page's "last night" for a selected day is exactly the
 * night keyed to that day. Never falls back to an older night: a missing
 * night is reported as missing (nightMissingText), not replaced by whatever
 * was recorded last.
 */
export function nightEndingOn<T extends { date: string }>(nights: readonly T[], day: string): T | null {
  return nights.find(n => n.date === day) ?? null
}

/** "last night" on today, "that night" for a past day. */
export function nightNoun(day: string, today: string): string {
  return day === today ? 'last night' : 'that night'
}

/** "No sleep recorded last night" / "No sleep recorded that night". */
export function nightMissingText(day: string, today: string): string {
  return `No sleep recorded ${nightNoun(day, today)}`
}
