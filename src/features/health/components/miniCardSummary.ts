// What number a mini card shows and whether it has anything to show at all.
// Pure (scripts/verify-health-window-stats.cjs §13).
import { summarizeWindow, windowRuleFor, type DayValue } from '../healthWindowStats'

export interface MiniSummary {
  value: number | null
  /** "Latest", "Today so far", "That day", "Daily avg", "Avg". */
  label: string
  /** The day a 'latest' value comes from. */
  latestDate: string | null
  /** Days behind a multi-day average. */
  days: number | null
  hasData: boolean
}

export function miniCardSummary(
  aggType: string,
  daily: readonly DayValue[],
  latest: { value: number; date: string } | null | undefined,
  win: { from: string; to: string },
  today: string,
): MiniSummary {
  const rule = windowRuleFor(aggType)
  // Point-in-time metrics (VO2 max, 6-minute walk, cardio recovery…) are
  // written rarely — VO2 max only after a qualifying outdoor walk or run — so
  // the newest reading EVER (up to the viewed day) is the answer, not the
  // newest inside the window, which was "—" most days (H-04).
  if (rule.kind === 'latest') {
    return { value: latest?.value ?? null, label: 'Latest', latestDate: latest?.date ?? null, days: null, hasData: latest != null }
  }
  const s = summarizeWindow(rule.kind, daily, { from: win.from, to: win.to, today, todayComplete: rule.todayComplete })
  if (s.totalDays === 1) {
    return { value: s.value, label: s.partialToday ? 'Today so far' : 'That day', latestDate: null, days: null, hasData: s.value != null }
  }
  return {
    value: s.value,
    label: rule.kind === 'sum' ? 'Daily avg' : 'Avg',
    latestDate: null,
    days: s.daysCounted,
    // A window whose only reading is today's unfinished day still has data.
    hasData: s.daysWithData > 0,
  }
}
