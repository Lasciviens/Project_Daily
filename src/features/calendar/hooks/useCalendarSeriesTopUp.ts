import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCalendarStore } from '../../../app/store'
import { qk, STALE } from '../../../shared/query'
import { logError } from '../../../shared/utils/logError'
import { fetchScheduleBlocks } from '../../daily/api/scheduleApi'
import { topUpSeriesHorizons } from '../api/scheduleSeriesCalendar'

/**
 * Once per app open, when Google is connected: a monthly-kind plan's
 * repeating event lists its days a year ahead (an RDATE list — no RRULE says
 * "the Saturday nearest the 13th"), so the list is pushed again once fewer
 * than 90 days of it remain (migration 147). Silent: nothing was asked for; a
 * failure is logged and the next open tries again.
 */
export function useCalendarSeriesTopUp() {
  const qc = useQueryClient()
  // Waits for the token: a fresh load restores it a moment after mounting.
  const connected = useCalendarStore(s => !!s.accessToken)
  const done = useRef(false)
  useEffect(() => {
    if (!connected || done.current) return
    done.current = true
    qc.fetchQuery({ queryKey: qk.schedule.templates(), queryFn: fetchScheduleBlocks, staleTime: STALE.long })
      .then(topUpSeriesHorizons)
      .catch(err => logError(`Calendar series top-up failed: ${(err as Error).message}`, { action: 'calendar_series_top_up' }))
  }, [qc, connected])
}
