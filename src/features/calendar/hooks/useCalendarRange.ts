import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useCalendarStore } from '../../../app/store'
import { fetchEventsForRange } from '../api/calendarApi'
import { qk, STALE } from '../../../shared/query'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { ensureToken, useSelectedCalendarIds, useValidToken } from './useCalendar'

// The selected Google calendars' events over a range of days — the week strip's
// and the month calendar's. A module of its own, so pages that never show a
// range (Settings) don't carry it in their first download.

/** One event's day in a range, its id and the series it belongs to (an instance). */
interface EventDay { date: string; id?: string | null; series: string | null }

/**
 * The selected calendars' events in a range as one read (the month or the
 * week strip), shaped by `shape`. A repeating plan's own series (147) is not
 * "something on Google": its instances are left out before `shape` sees them,
 * or every day the plan repeats on would count.
 */
function useCalendarRange<T>(startDate: Date, endDate: Date, shape: (days: EventDay[]) => T) {
  const token                = useValidToken()
  const { setAccessToken }   = useCalendarStore()
  const startStr             = format(startDate, 'yyyy-MM-dd')
  const endStr               = format(endDate,   'yyyy-MM-dd')
  const calIds               = useSelectedCalendarIds()
  const { data: plans }      = useScheduleBlocks()
  const linkedSeries = useMemo(
    () => (plans ?? []).map(p => p.google_calendar_event_id).filter(Boolean).sort().join(','), [plans])
  const select = useCallback((days: EventDay[]) => {
    const linked = new Set(linkedSeries ? linkedSeries.split(',') : [])
    return shape(days.filter(d => !(d.series && linked.has(d.series))))
  }, [linkedSeries, shape])

  return useQuery({
    queryKey: qk.calendar.dates(startStr, endStr, calIds.join(',')),
    queryFn:  async () => {
      const activeToken = await ensureToken(token, setAccessToken)
      const timeMin = new Date(startStr + 'T00:00:00').toISOString()
      // Exclusive upper bound (see calendarApi.ts's fetchEventsForDay) —
      // next-day midnight after endStr, not endStr's own 23:59:59.
      const timeMaxDate = new Date(endStr + 'T00:00:00')
      timeMaxDate.setDate(timeMaxDate.getDate() + 1)
      const timeMax = timeMaxDate.toISOString()

      const results = await Promise.all(
        calIds.map(id => fetchEventsForRange(activeToken, timeMin, timeMax, id))
      )
      const days: EventDay[] = []
      for (const events of results) {
        for (const e of events) {
          const d = e.start.dateTime?.slice(0, 10) ?? e.start.date
          if (d) days.push({ date: d, id: e.id ?? null, series: e.recurringEventId ?? null })
        }
      }
      return days
    },
    select,
    enabled:   !!token,
    staleTime: STALE.default,
    retry:     false,
  })
}

const datesOf = (days: EventDay[]) => new Set(days.map(d => d.date))
// An answer kept from before ids were read has none: such an event counts (null never matches a slot's event).
const idsByDay = (days: EventDay[]) => {
  const out = new Map<string, (string | null)[]>()
  for (const d of days) out.set(d.date, [...(out.get(d.date) ?? []), d.id ?? null])
  return out
}

/** A Set<'yyyy-MM-dd'> of the days in the range with at least one calendar event (the week strip's dot). */
export function useCalendarEventDatesForRange(startDate: Date, endDate: Date) {
  return useCalendarRange(startDate, endDate, datesOf)
}

/** Each day's calendar event ids in the range (null for one with no id): the
 *  month calendar's plans line, from the same read as the dates above. */
export function useCalendarEventIdsByDay(startDate: Date, endDate: Date) {
  return useCalendarRange(startDate, endDate, idsByDay)
}
