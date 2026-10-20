import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { STALE } from '../../../shared/query'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { dayTasksQuery } from '../../todo/hooks/useTodos'
import { timeBlocksQuery, trainingBlocksQuery } from '../../daily/hooks/useSchedule'
import { useCalendarDaysPrefetch } from '../../calendar/hooks/useCalendar'
import { trainingRangeFor } from './useTodayOverview'

/**
 * Reads the shown week's days ahead, into the same cache entries the day
 * reads use (the one day list, the slots, the calendar, the week's training),
 * so picking a day in Home's or Personal's week strip shows it at once (owner, 16.10.2026:
 * "why is it so slow to change date?" — every pick was a cold read). Starts
 * once the page is idle; a day already read and fresh is not read again.
 */
export function usePrefetchWeek(monday: string) {
  const qc = useQueryClient()
  const prefetchCalendar = useCalendarDaysPrefetch()
  useEffect(() => {
    const run = () => {
      const today = todayStr()
      const days = Array.from({ length: 7 }, (_, i) => shiftDateStr(monday, i))
      // A day read in the last few minutes is not read again (the day view still refreshes it on its own).
      for (const d of days) void qc.prefetchQuery({ ...dayTasksQuery(d, today), staleTime: STALE.default })
      // Each day also reads the day before it (a slot past midnight).
      for (const d of [shiftDateStr(monday, -1), ...days]) void qc.prefetchQuery(timeBlocksQuery(d))
      const other = days.find(d => d !== today)
      if (other) {
        const r = trainingRangeFor(other, today)
        void qc.prefetchQuery(trainingBlocksQuery(r.from, r.to))
      }
      prefetchCalendar(days)
    }
    const idle = window.requestIdleCallback?.bind(window)
    if (idle) {
      const id = idle(run, { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 300)
    return () => window.clearTimeout(id)
  }, [qc, monday, prefetchCalendar])
}
