import { useQuery } from '@tanstack/react-query'
import { useCalendarStore } from '../../../app/store'
import { fetchEventsForDay, fetchEventsForRange } from '../api/calendarApi'

export function useCalendarEventsForDay(dateStr: string) {
  const token = useCalendarStore(s => s.accessToken)
  return useQuery({
    queryKey: ['calendar', 'day', dateStr],
    queryFn:  () => fetchEventsForDay(token!, dateStr),
    enabled:  !!token,
    staleTime: 5 * 60_000,
  })
}

export function useCalendarEventsForRange(timeMin: string, timeMax: string) {
  const token = useCalendarStore(s => s.accessToken)
  return useQuery({
    queryKey: ['calendar', 'range', timeMin, timeMax],
    queryFn:  () => fetchEventsForRange(token!, timeMin, timeMax),
    enabled:  !!token,
    staleTime: 5 * 60_000,
  })
}
