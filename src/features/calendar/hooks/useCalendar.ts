import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useCalendarStore } from '../../../app/store'
import { supabase } from '../../../integrations/supabase/client'
import {
  fetchEventsForDay,
  fetchEventsForRange,
  fetchCalendarList,
  refreshCalendarToken,
} from '../api/calendarApi'

const REFRESH_THRESHOLD_MS = 5 * 60_000  // refresh when ≤5 min remaining

// Returns a valid access token or null.  Does NOT trigger a refresh — that is
// handled by useAutoRefreshCalendarToken which runs in CalendarConnect.
function useValidToken(): string | null {
  const { accessToken, expiresAt } = useCalendarStore()
  if (!accessToken) return null
  if (expiresAt && Date.now() > expiresAt - 60_000) return null
  return accessToken
}

// Silently restore or refresh the calendar access token.
// • On mount with no token: calls calendar-token edge function to get a fresh
//   access_token using the stored refresh_token (if the user has ever connected).
// • Schedules a proactive refresh when the token is within 5 minutes of expiry.
export function useAutoRefreshCalendarToken() {
  const { accessToken, expiresAt, setAccessToken } = useCalendarStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function doRefresh() {
    try {
      const { access_token, expires_in } = await refreshCalendarToken(supabase)
      setAccessToken(access_token, expires_in)
    } catch {
      // 'not_connected' is expected when the user hasn't linked Calendar yet
    }
  }

  // Restore token on mount if we have no valid token in the store
  useEffect(() => {
    const isValid = accessToken && (!expiresAt || Date.now() < expiresAt - 60_000)
    if (!isValid) {
      doRefresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Schedule a proactive refresh before the current token expires
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!accessToken || !expiresAt) return

    const msUntilRefresh = expiresAt - Date.now() - REFRESH_THRESHOLD_MS
    if (msUntilRefresh <= 0) {
      doRefresh()
      return
    }

    timerRef.current = setTimeout(doRefresh, msUntilRefresh)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, expiresAt])
}

export function useCalendarEventsForDay(dateStr: string) {
  const token = useValidToken()
  const { setAccessToken } = useCalendarStore()

  return useQuery({
    queryKey: ['calendar', 'day', dateStr],
    queryFn:  async () => {
      // Inline refresh if token expired by the time the query fires
      let activeToken = token
      if (!activeToken) {
        const fresh = await refreshCalendarToken(supabase)
        setAccessToken(fresh.access_token, fresh.expires_in)
        activeToken = fresh.access_token
      }
      return fetchEventsForDay(activeToken, dateStr)
    },
    enabled:   !!token,
    staleTime: 5 * 60_000,
    retry:     false,
  })
}

export function useCalendarEventsForRange(timeMin: string, timeMax: string) {
  const token = useValidToken()
  const { setAccessToken } = useCalendarStore()

  return useQuery({
    queryKey: ['calendar', 'range', timeMin, timeMax],
    queryFn:  async () => {
      let activeToken = token
      if (!activeToken) {
        const fresh = await refreshCalendarToken(supabase)
        setAccessToken(fresh.access_token, fresh.expires_in)
        activeToken = fresh.access_token
      }
      return fetchEventsForRange(activeToken, timeMin, timeMax)
    },
    enabled:   !!token,
    staleTime: 5 * 60_000,
    retry:     false,
  })
}

export function useCalendarList() {
  const token = useValidToken()
  return useQuery({
    queryKey: ['calendar', 'list'],
    queryFn:  () => fetchCalendarList(token!),
    enabled:  !!token,
    staleTime: 60 * 60_000,
    retry:     false,
  })
}

// Returns a Set<'yyyy-MM-dd'> of dates that have at least one calendar event
// in the given date range, across all selected calendars.
export function useCalendarEventDatesForRange(startDate: Date, endDate: Date) {
  const token                = useValidToken()
  const { selectedCalendarIds, setAccessToken } = useCalendarStore()
  const startStr             = format(startDate, 'yyyy-MM-dd')
  const endStr               = format(endDate,   'yyyy-MM-dd')
  const calIds               = selectedCalendarIds ?? ['primary']

  return useQuery({
    queryKey: ['calendar', 'dates', startStr, endStr, calIds.join(',')],
    queryFn:  async () => {
      let activeToken = token
      if (!activeToken) {
        const fresh = await refreshCalendarToken(supabase)
        setAccessToken(fresh.access_token, fresh.expires_in)
        activeToken = fresh.access_token
      }
      const timeMin = new Date(startStr + 'T00:00:00').toISOString()
      const timeMax = new Date(endStr   + 'T23:59:59').toISOString()

      const results = await Promise.all(
        calIds.map(id => fetchEventsForRange(activeToken, timeMin, timeMax, id))
      )
      const dates = new Set<string>()
      for (const events of results) {
        for (const e of events) {
          const d = e.start.dateTime?.slice(0, 10) ?? e.start.date
          if (d) dates.add(d)
        }
      }
      return dates
    },
    enabled:   !!token,
    staleTime: 5 * 60_000,
    retry:     false,
  })
}
