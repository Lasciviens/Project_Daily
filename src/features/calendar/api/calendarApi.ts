import type { SupabaseClient } from '@supabase/supabase-js'
import type { CalendarEvent, CalendarListEntry } from '../types'

const BASE = 'https://www.googleapis.com/calendar/v3'

async function gcalFetch<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Calendar API ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchCalendarList(token: string): Promise<CalendarListEntry[]> {
  const data = await gcalFetch<{ items: CalendarListEntry[] }>('/users/me/calendarList', token)
  return data.items ?? []
}

export async function fetchEventsForDay(token: string, date: string, calendarId = 'primary'): Promise<CalendarEvent[]> {
  // Use local midnight so events near midnight aren't missed
  const timeMin = new Date(date + 'T00:00:00').toISOString()
  const timeMax = new Date(date + 'T23:59:59').toISOString()
  const data = await gcalFetch<{ items: CalendarEvent[] }>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    token,
    { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' }
  )
  return data.items ?? []
}

export async function exchangeCalendarCode(
  supabase: SupabaseClient,
  code: string
): Promise<{ access_token: string; expires_in: number }> {
  const { data, error } = await supabase.functions.invoke('calendar-oauth', {
    body: { code },
  })
  if (error) {
    const detail = data?.error ?? error.message
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.error)
  return data as { access_token: string; expires_in: number }
}

export async function refreshCalendarToken(
  supabase: SupabaseClient
): Promise<{ access_token: string; expires_in: number }> {
  const { data, error } = await supabase.functions.invoke('calendar-token', {
    body: {},
  })
  if (error) throw new Error(error.message)
  if (data.error) throw new Error(data.error)
  return data as { access_token: string; expires_in: number }
}

export async function disconnectCalendar(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.functions.invoke('calendar-disconnect', {
    body: {},
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
}

export async function fetchEventsForRange(
  token: string,
  timeMin: string,
  timeMax: string,
  calendarId = 'primary'
): Promise<CalendarEvent[]> {
  const data = await gcalFetch<{ items: CalendarEvent[] }>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    token,
    { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' }
  )
  return data.items ?? []
}
