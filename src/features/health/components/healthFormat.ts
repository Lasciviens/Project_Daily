import { formatDate, formatDayMonth, formatWeekday, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import type { WindowSummary } from '../healthWindowStats'

// The Health feature's date and number formatters — these were copied into
// six files with three different formats (H-21). Dates are DD.MM.YYYY
// (shared/utils/dateFormat.ts); chart ticks alone drop the year.

/** "Mon 21.09" — chart axis labels for daily points. */
export function fmtAxisDay(date: string): string {
  return `${formatWeekday(date)} ${formatDayMonth(date)}`
}

/** "21.09" — chart axis label once weekday names would repeat. */
export function fmtAxisDate(date: string): string {
  return formatDayMonth(date)
}

/** Axis label for a daily point: "Mon 21.09" in short windows, "21.09" once
 *  the window is long enough that a weekday name would repeat ambiguously. */
export function fmtAxisFor(date: string, totalDays: number): string {
  return totalDays > 45 ? fmtAxisDate(date) : fmtAxisDay(date)
}

/** "21.09.2026". */
export function fmtDayMonth(date: string): string {
  return formatDate(date)
}

/** "Mon 21.09.2026". */
export function fmtDayLong(date: string): string {
  return formatWeekdayDate(date)
}

/** "45m", "1h 05m", "—" for nothing. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—'
  const mins = Math.round(seconds / 60)
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

/** Thousands-separated integer, "—" for null. */
export function fmtInt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-GB')
}

/** "+4%" / "−3%" for a trend badge; null when there's nothing to say. */
export function fmtPct(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null
  const r = Math.round(v)
  if (r === 0) return null
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}%`
}

/** The caption that says which days a headline number is made of. */
export function windowCaption(s: WindowSummary, opts: { unitNoun?: string } = {}): string | null {
  const noun = opts.unitNoun ?? 'days'
  if (s.totalDays === 1) return s.partialToday ? 'So far today' : null
  const parts = [`${s.daysCounted} of ${s.totalDays} ${noun}`]
  if (s.partialToday) parts.push('today left out until it ends')
  return parts.join(' · ')
}
