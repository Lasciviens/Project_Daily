import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useCalendarStore } from '../../../app/store'
import { supabase } from '../../../integrations/supabase/client'
import {
  fetchEventsForDay,
  fetchEventsForRange,
  fetchCalendarList,
  refreshCalendarToken,
  updateCalendarEvent,
  deleteCalendarEvent,
  createCalendarEvent,
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

// Query-time fallback: if the token expired between render and the query
// actually firing, refresh it inline and persist the fresh one to the store.
// Was duplicated identically across 3 query hooks below.
async function ensureToken(token: string | null, setAccessToken: (t: string, e: number) => void): Promise<string> {
  if (token) return token
  const fresh = await refreshCalendarToken(supabase)
  setAccessToken(fresh.access_token, fresh.expires_in)
  return fresh.access_token
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
    queryFn:  async () => fetchEventsForDay(await ensureToken(token, setAccessToken), dateStr),
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
    queryFn:  async () => fetchEventsForRange(await ensureToken(token, setAccessToken), timeMin, timeMax),
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

export function useUpdateCalendarEvent() {
  const qc = useQueryClient()
  const { accessToken } = useCalendarStore()
  return useMutation({
    mutationFn: ({ calendarId, eventId, patch }: {
      calendarId: string
      eventId:    string
      patch:      Record<string, unknown>
    }) => updateCalendarEvent(accessToken!, calendarId, eventId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  })
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient()
  const { accessToken } = useCalendarStore()
  return useMutation({
    mutationFn: ({ calendarId, eventId }: { calendarId: string; eventId: string }) =>
      deleteCalendarEvent(accessToken!, calendarId, eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  })
}

export function useCreateCalendarEvent() {
  const qc = useQueryClient()
  const { accessToken } = useCalendarStore()
  return useMutation({
    mutationFn: ({ calendarId, event }: {
      calendarId: string
      event: {
        summary:      string
        description?: string
        start:        { dateTime: string; timeZone: string }
        end:          { dateTime: string; timeZone: string }
      }
    }) => createCalendarEvent(accessToken!, calendarId, event),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
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
      const activeToken = await ensureToken(token, setAccessToken)
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
