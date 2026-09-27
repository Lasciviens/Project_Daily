import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { makeWindow, type HealthWindow } from '../healthWindowStats'
import type { Period } from './PeriodToggle'
import type { HealthRange } from './sectionTypes'

// Health's windows are ROLLING: "7 days" is the seven days ending on the
// anchor, "30 days" the thirty ending on it. They are labelled that way ("Last
// 7 days"), never "(this week)" — Training's weeks start on Monday, and a
// rolling window labelled as a calendar week meant two different things
// across tabs (T42 / H-17).
export const SPAN_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 }

// Every Health read starts at least this far back, whatever the period: the
// hero's 60-day baselines and the 90-day trend stats (90 + the 90 before)
// need it, and one shared start date means the hero, the sections and the
// trend stats all read ONE download per metric.
export const LONG_BACK_DAYS = 186

export function rangeForAnchor(period: Period, anchor: string): { from: string; to: string } {
  return { from: shiftDateStr(anchor, -(SPAN_DAYS[period] - 1)), to: anchor }
}

/** The selected window + the same-length window before it, for hooks. */
export function healthWindowFor(range: Pick<HealthRange, 'period' | 'anchor'>): HealthWindow {
  const { from, to } = rangeForAnchor(range.period, range.anchor)
  const win = makeWindow(from, to, todayStr())
  const longFrom = shiftDateStr(to, -LONG_BACK_DAYS)
  return longFrom < win.fetchFrom ? { ...win, fetchFrom: longFrom } : win
}

/** Memoised window for a HealthRange — stable while period/anchor are. */
export function useRangeWindow(range: Pick<HealthRange, 'period' | 'anchor'>): HealthWindow {
  const { period, anchor } = range
  return useMemo(() => healthWindowFor({ period, anchor }), [period, anchor])
}

// Anchor is always the last day of the visible window — stepping never goes
// past today (no browsing into the future).
export function stepAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  const next = shiftDateStr(anchor, SPAN_DAYS[period] * dir)
  const today = todayStr()
  return next > today ? today : next
}

function rangeLabel(from: string, to: string): string {
  const fromD = parseISO(from), toD = parseISO(to)
  return format(fromD, 'MMM yyyy') === format(toD, 'MMM yyyy')
    ? `${format(fromD, 'd')}–${format(toD, 'd MMM')}`
    : format(fromD, 'yyyy') === format(toD, 'yyyy')
      ? `${format(fromD, 'd MMM')} – ${format(toD, 'd MMM')}`
      : `${format(fromD, 'd MMM yyyy')} – ${format(toD, 'd MMM yyyy')}`
}

export function labelForAnchor(period: Period, anchor: string): string {
  const today = todayStr()
  if (period === 'day') {
    if (anchor === today) return 'Today'
    if (anchor === shiftDateStr(today, -1)) return 'Yesterday'
    return format(parseISO(anchor), 'EEE, d MMM')
  }
  const { from, to } = rangeForAnchor(period, anchor)
  const span = rangeLabel(from, to)
  return anchor === today ? `${period === 'year' ? 'Last 12 months' : `Last ${SPAN_DAYS[period]} days`} · ${span}` : span
}

/** Short noun for the headline eyebrow: "last 7 days", "21–27 Sep", "today". */
export function windowNoun(period: Period, anchor: string): string {
  const today = todayStr()
  if (period === 'day') return anchor === today ? 'today' : format(parseISO(anchor), 'EEE d MMM')
  const { from, to } = rangeForAnchor(period, anchor)
  return anchor === today ? (period === 'year' ? 'last 12 months' : `last ${SPAN_DAYS[period]} days`) : rangeLabel(from, to)
}
