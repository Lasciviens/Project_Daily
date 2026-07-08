import { addDays, format, parseISO } from 'date-fns'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { Period } from './PeriodToggle'

const STEP_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 }

export function shiftStr(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), 'yyyy-MM-dd')
}

export function rangeForAnchor(period: Period, anchor: string): { from: string; to: string } {
  if (period === 'day') return { from: anchor, to: anchor }
  if (period === 'week') return { from: shiftStr(anchor, -6), to: anchor }
  return { from: shiftStr(anchor, -29), to: anchor }
}

// Anchor is always the last day of the visible window — stepping never goes
// past today (no browsing into the future).
export function stepAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  const next = shiftStr(anchor, STEP_DAYS[period] * dir)
  return next > todayStr() ? todayStr() : next
}

export function labelForAnchor(period: Period, anchor: string): string {
  const isToday = anchor === todayStr()
  if (period === 'day') {
    return isToday ? 'Today' : format(parseISO(anchor), 'EEE, d MMM')
  }
  const { from, to } = rangeForAnchor(period, anchor)
  const fromD = parseISO(from)
  const toD = parseISO(to)
  const sameMonth = format(fromD, 'MMM') === format(toD, 'MMM')
  const rangeLabel = sameMonth
    ? `${format(fromD, 'd')}–${format(toD, 'd MMM')}`
    : `${format(fromD, 'd MMM')} – ${format(toD, 'd MMM')}`
  const suffix = isToday ? (period === 'week' ? ' (this week)' : ' (this month)') : ''
  return `${rangeLabel}${suffix}`
}
