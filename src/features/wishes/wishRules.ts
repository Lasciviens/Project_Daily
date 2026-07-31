import { windowRangeLabel } from '../../shared/components/windowChips'
import type { WishItem } from './types'

// Pure window logic — no React, no Supabase, so it can be exercised by a
// throwaway sucrase script (the repo has no unit-test runner by convention).
//
// 'yyyy-MM-dd' strings compare lexicographically, which is why no Date is ever
// constructed here: string compares are exactly calendar-date compares and
// carry no timezone of their own.

export type WishWindowState = 'open' | 'upcoming' | 'passed' | 'anytime'

export function resolveWishWindow(
  w: Pick<WishItem, 'period_start' | 'period_end'>,
  today: string,
): WishWindowState {
  const { period_start: start, period_end: end } = w
  if (!start && !end) return 'anytime'
  if (start && today < start) return 'upcoming'
  if (end && today > end) return 'passed'
  // Covers one-sided windows too: an open-ended start that has arrived, and an
  // end that has not been reached yet, are both simply open.
  return 'open'
}

// The user's own word for the period wins over a derived date range — "This
// winter" is what he wrote down; the range is only the fallback rendering.
export function wishPeriodLabel(
  w: Pick<WishItem, 'period_start' | 'period_end' | 'period_label'>,
): string | null {
  return w.period_label ?? windowRangeLabel(w.period_start, w.period_end)
}
