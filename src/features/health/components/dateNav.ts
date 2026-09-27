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
const SPAN_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 }

export function rangeForAnchor(period: Period, anchor: string): { from: string; to: string } {
  return { from: shiftDateStr(anchor, -(SPAN_DAYS[period] - 1)), to: anchor }
}

/** The selected window + the same-length window before it, for hooks. */
export function healthWindowFor(range: Pick<HealthRange, 'period' | 'anchor'>): HealthWindow {
  const { from, to } = rangeForAnchor(range.period, range.anchor)
  return makeWindow(from, to, todayStr())
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
    : `${format(fromD, 'd MMM')} – ${format(toD, 'd MMM')}`
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
  return anchor === today ? `Last ${SPAN_DAYS[period]} days · ${span}` : span
}

/** Short noun for the headline eyebrow: "last 7 days", "21–27 Sep", "today". */
export function windowNoun(period: Period, anchor: string): string {
  const today = todayStr()
  if (period === 'day') return anchor === today ? 'today' : format(parseISO(anchor), 'EEE d MMM')
  const { from, to } = rangeForAnchor(period, anchor)
  return anchor === today ? `last ${SPAN_DAYS[period]} days` : rangeLabel(from, to)
}
