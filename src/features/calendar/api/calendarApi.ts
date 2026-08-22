import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import type { CalendarEvent, CalendarListEntry } from '../types'

const BASE = 'https://www.googleapis.com/calendar/v3'

// A typed error carrying the real HTTP status, so callers can make
// correctness decisions (e.g. "was this event genuinely deleted, or did the
// request merely fail?") on the STATUS, never on brittle substring matching
// against an error message that may not even mention the status at all
// (some Google error bodies carry only a human message like "Not Found").
export interface CalendarApiErrorBody {
  error?: { message?: string; code?: number; errors?: unknown[] }
}
export class CalendarApiError extends Error {
  readonly status: number
  readonly body?: CalendarApiErrorBody
  constructor(status: number, message: string, body?: CalendarApiErrorBody) {
    super(message)
    this.name = 'CalendarApiError'
    this.status = status
    this.body = body
  }
}
/** The ONE place that decides "is this a confirmed 404" — every caller
 *  (scheduleApi.ts, scheduleSyncRules.ts) must go through this rather than
 *  re-deriving it from the error message. */
export function isCalendarNotFound(error: unknown): boolean {
  return error instanceof CalendarApiError && error.status === 404
}

async function gcalRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    const body: CalendarApiErrorBody | undefined = await res.json().catch(() => undefined)
    throw new CalendarApiError(res.status, body?.error?.message ?? `Calendar API ${res.status}`, body)
  }
  return res.json() as Promise<T>
}

async function gcalFetch<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  return gcalRequest<T>(qs ? `${path}?${qs}` : path, token)
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
  return (data.items ?? []).map(e => ({ ...e, calendarId }))
}

export async function exchangeCalendarCode(
  supabase: SupabaseClient,
  code: string
): Promise<{ access_token: string; expires_in: number }> {
  const { data, error } = await supabase.functions.invoke('calendar-oauth', {
    body: { code },
  })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new Error((body?.error as string | undefined) ?? error.message)
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
  return (data.items ?? []).map(e => ({ ...e, calendarId }))
}

export async function updateCalendarEvent(
  token: string,
  calendarId: string,
  eventId: string,
  patch: Record<string, unknown>
): Promise<CalendarEvent> {
  return gcalRequest<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
    { method: 'PATCH', body: JSON.stringify(patch) }
  )
}

export async function deleteCalendarEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await gcalRequest<void>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
    { method: 'DELETE' }
  )
}

export async function createCalendarEvent(
  token: string,
  calendarId: string,
  event: {
    summary:     string
    description?: string
    start:       { dateTime: string; timeZone: string }
    end:         { dateTime: string; timeZone: string }
  }
): Promise<CalendarEvent> {
  return gcalRequest<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    token,
    { method: 'POST', body: JSON.stringify(event) }
  )
}
