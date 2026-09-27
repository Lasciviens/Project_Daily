import { fmtDateEnGB } from '../../../shared/utils/enGBDate'
import type { WindowSummary } from '../healthWindowStats'

// The Health feature's date and number formatters — these were copied into
// six files with three different formats (H-21). en-GB throughout.

const localDate = (date: string) => new Date(`${date}T00:00:00`)

/** "Mon 21" — chart axis labels for daily points. */
export function fmtAxisDay(date: string): string {
  return localDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

/** Axis label for a daily point: "Mon 21" in short windows, "21 Sep" once the
 *  window is long enough that a weekday name would repeat ambiguously. */
export function fmtAxisFor(date: string, totalDays: number): string {
  return totalDays > 45 ? fmtDayMonth(date) : fmtAxisDay(date)
}

/** "21 Sep" (plus the year when it isn't this year). */
export function fmtDayMonth(date: string): string {
  const d = localDate(date)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return fmtDateEnGB(d, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Mon, 21 Sep" (plus the year when it isn't this year). */
export function fmtDayLong(date: string): string {
  const d = localDate(date)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return fmtDateEnGB(d, sameYear
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
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
