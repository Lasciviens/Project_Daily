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
/** A create using a client-supplied deterministic id landed already (a prior
 *  attempt's POST reached Google but its response never reached us) — see
 *  createCalendarEvent's `id` param and getCalendarEvent below. */
export function isCalendarConflict(error: unknown): boolean {
  return error instanceof CalendarApiError && error.status === 409
}

// ensureValidCalendarToken / ensureLinkedCalendarEventRemoved live in
// calendarTokenSync.ts, NOT here — this file's whole point is staying
// import-free of the live supabase client / Zustand store singletons (every
// function here takes a `token` or a `SupabaseClient` as a PARAMETER, e.g.
// exchangeCalendarCode/refreshCalendarToken/disconnectCalendar below), which
// is exactly what lets scripts/verify-plan-modal-helpers.cjs require
// CalendarApiError/isCalendarNotFound as pure, un-mocked code via sucrase.
// A real regression: those two functions were added directly in this file
// during review, importing the live `supabase` client + `useCalendarStore`
// at module scope — which broke that exact verify script (the client
// bootstrap needs a live Vite env). Moved out once caught.

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
  // Use local midnight so events near midnight aren't missed. timeMax is an
  // EXCLUSIVE upper bound per Google's own events.list semantics (verified
  // against the API's documented filter: an event matches when
  // event.end > timeMin AND event.start < timeMax) — `date+"T23:59:59"` is
  // one second short of that, which could in principle miss an event
  // starting in that last second. The exclusive boundary is next-day
  // midnight, not 23:59:59 of THIS day.
  const timeMin = new Date(date + 'T00:00:00').toISOString()
  const nextDay = new Date(date + 'T00:00:00')
  nextDay.setDate(nextDay.getDate() + 1)
  const timeMax = nextDay.toISOString()
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
    /** Optional client-supplied event id (Calendar's own base32hex charset —
     *  lowercase a-v and 0-9, 5-1024 chars — a hex-only string like a UUID
     *  with its dashes stripped is a valid subset). Makes the create
     *  retry-safe: Google's Tasks API has no equivalent (no client id, no
     *  requestId — a genuine, documented Tasks API limitation, not
     *  something this app can close), but Calendar's events.insert DOES
     *  accept one, so a retry after a network timeout (POST landed on
     *  Google, the response never reached us) can reuse the SAME id — see
     *  isCalendarConflict/getCalendarEvent for the resulting 409-then-adopt
     *  pattern, instead of silently minting a second event. */
    id?: string
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

export async function getCalendarEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<CalendarEvent> {
  return gcalRequest<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
  )
}
