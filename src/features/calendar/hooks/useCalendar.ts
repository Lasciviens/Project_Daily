import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useCalendarStore } from '../../../app/store'
import { supabase } from '../../../integrations/supabase/client'
import type { CalendarEvent } from '../types'
import {
  fetchEventsForDay,
  fetchEventsForRange,
  fetchCalendarList,
  refreshCalendarToken,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../api/calendarApi'
import { qk, STALE } from '../../../shared/query'
import { ensureValidCalendarToken } from '../api/calendarTokenSync'
import { useScheduleBlocks } from '../../daily/hooks/useSchedule'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'

const REFRESH_THRESHOLD_MS = 5 * 60_000  // refresh when ≤5 min remaining

// Returns a valid access token or null.  Does NOT trigger a refresh — that is
// handled by useAutoRefreshCalendarToken which runs in CalendarConnect.
function useValidToken(): string | null {
  const { accessToken, expiresAt } = useCalendarStore()
  if (!accessToken) return null
  // Reading the clock here is deliberate: an expired token must disable the
  // queries on the very render it expires; the refresh timer re-renders us.
  // eslint-disable-next-line react-hooks/purity
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

// Sorts a merged multi-calendar event list back into one chronological
// agenda — all-day events (date, no dateTime) sort first, then by start time.
function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const aKey = a.start.dateTime ?? (a.start.date ? `${a.start.date}T00:00:00` : '')
    const bKey = b.start.dateTime ?? (b.start.date ? `${b.start.date}T00:00:00` : '')
    return aKey.localeCompare(bKey)
  })
}

// The real, still-remaining reason "reconnect + grant the new scope" alone
// didn't bring subscribed calendars back: `selectedCalendarIds: null` means
// two DIFFERENT things in two different places. WeekWidget's own filter UI
// (`isCalSelected`) treats null as "every calendar is selected" — which is
// why every checkbox shows green/checked with no explicit action taken.
// But every fetch hook (this file) used to fall back to `selectedCalendarIds
// ?? ['primary']` — treating the SAME null as "only primary". A user who
// never explicitly opened "⊞ Filter calendars" and toggled anything (the
// overwhelmingly common case — the control isn't discoverable, and
// selecting is never required since everything already reads as selected)
// keeps `selectedCalendarIds === null` forever, so every fetch silently
// stayed primary-only regardless of the OAuth scope being fixed.
// `useSelectedCalendarIds` is the ONE place this null now means "all
// calendars this account actually has" (from the SAME `useCalendarList()`
// query every fetch hook already needs for the picker), falling back to
// `['primary']` only while that list hasn't loaded yet (e.g. Calendar not
// connected, or the very first render before the query resolves).
function useSelectedCalendarIds(): string[] {
  const { selectedCalendarIds } = useCalendarStore()
  const { data: calList = [] } = useCalendarList()
  if (selectedCalendarIds) return selectedCalendarIds
  return calList.length > 0 ? calList.map(c => c.id) : ['primary']
}

// Real bug, fixed: this used to fetch ONLY the 'primary' calendar
// (calendarApi.ts's own default), so a user's SUBSCRIBED/secondary
// calendars (selected via WeekWidget's "⊞ Filter calendars", persisted as
// `selectedCalendarIds`) never appeared in the actual agenda list — only
// in the week/month grid's dot indicators, which already looped
// `selectedCalendarIds` via useCalendarEventDatesForRange below. Mirrors
// that same loop-and-merge shape.
function calendarDayQuery(dateStr: string, calIds: string[], token: string | null, setAccessToken: (t: string, e: number) => void) {
  return {
    queryKey: qk.calendar.day(dateStr, calIds.join(',')),
    queryFn:  async () => {
      const activeToken = await ensureToken(token, setAccessToken)
      const results = await Promise.all(calIds.map(id => fetchEventsForDay(activeToken, dateStr, id)))
      return sortEvents(results.flat())
    },
    staleTime: STALE.default,
    retry:     false,
  } as const
}

export function useCalendarEventsForDay(dateStr: string) {
  const token = useValidToken()
  const { setAccessToken } = useCalendarStore()
  const calIds = useSelectedCalendarIds()
  return useQuery({ ...calendarDayQuery(dateStr, calIds, token, setAccessToken), enabled: !!token })
}

/** Reads days' calendar events ahead (Home's week strip), into the same cache entries the day view reads. */
export function useCalendarDaysPrefetch(): (dates: readonly string[]) => void {
  const qc = useQueryClient()
  const token = useValidToken()
  const { setAccessToken } = useCalendarStore()
  // The ids as one string: the list is a new array on every render. Until the calendar list is in,
  // "every calendar" would read primary only and then again — wait for it.
  const { selectedCalendarIds } = useCalendarStore()
  const listReady = useCalendarList().isSuccess
  const ids = useSelectedCalendarIds().join(',')
  return useCallback((dates: readonly string[]) => {
    if (!token || !ids || (!selectedCalendarIds && !listReady)) return
    for (const d of dates) void qc.prefetchQuery(calendarDayQuery(d, ids.split(','), token, setAccessToken))
  }, [qc, token, setAccessToken, ids, selectedCalendarIds, listReady])
}

export function useCalendarList() {
  const token = useValidToken()
  return useQuery({
    queryKey: qk.calendar.list(),
    queryFn:  () => fetchCalendarList(token!),
    enabled:  !!token,
    staleTime: STALE.hour,
    retry:     false,
  })
}

export function useUpdateCalendarEvent() {
  return useMutationWithFeedback({
    action: 'update_calendar_event',
    successMessage: 'Event updated',
    mutationFn: async ({ calendarId, eventId, patch }: {
      calendarId: string
      eventId:    string
      patch:      Record<string, unknown>
    }) => {
      // Never the stored token as is (planning rules): refreshed when it is about to run out.
      const token = await ensureValidCalendarToken()
      if (!token) throw new Error('Google Calendar is not connected on this device')
      return updateCalendarEvent(token, calendarId, eventId, patch)
    },
    invalidates: [qk.calendar.all],
  })
}

export function useDeleteCalendarEvent() {
  return useMutationWithFeedback({
    action: 'delete_calendar_event',
    silent: 'the delete flow reports the result',
    mutationFn: async ({ calendarId, eventId }: { calendarId: string; eventId: string }) => {
      const token = await ensureValidCalendarToken()
      if (!token) throw new Error('Google Calendar is not connected on this device')
      await deleteCalendarEvent(token, calendarId, eventId)
      return true
    },
    invalidates: [qk.calendar.all],
  })
}

/** One event's day in a range, and the series it belongs to (an instance). */
interface EventDay { date: string; series: string | null }

// Returns a Set<'yyyy-MM-dd'> of dates that have at least one calendar event
// in the given date range, across all selected calendars. A repeating plan's
// own series (147) is not "something on Google": its instances are left out,
// or every day the plan repeats on would get a dot.
export function useCalendarEventDatesForRange(startDate: Date, endDate: Date) {
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
    return new Set(days.filter(d => !(d.series && linked.has(d.series))).map(d => d.date))
  }, [linkedSeries])

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
          if (d) days.push({ date: d, series: e.recurringEventId ?? null })
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
