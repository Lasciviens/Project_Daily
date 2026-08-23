// Deliberately SEPARATE from calendarApi.ts (which stays import-free of the
// live supabase client / Zustand store singleton so its pure error classes —
// CalendarApiError, isCalendarNotFound — stay requirable via sucrase in
// scripts/verify-plan-modal-helpers.cjs without needing a live Vite env).
// This file is exactly the opposite: it exists ONLY to hold the two helpers
// that genuinely need the live singletons.
import { supabase } from '../../../integrations/supabase/client'
import { useCalendarStore } from '../../../app/store'
import { refreshCalendarToken, deleteCalendarEvent, isCalendarNotFound } from './calendarApi'

// The write-side equivalent of useCalendar.ts's `ensureToken` — that hook
// version only runs inside a React component (needs the store's reactive
// accessToken/setAccessToken via useCalendarStore()); every plain async API
// function (scheduleApi.ts, tasksApi.ts, UnifiedPlanModal's linkCalendarEvent)
// needs the same "give me a token that's actually still valid, refreshing if
// not" behavior outside a component. Real gap this closes: every WRITE path
// used to read the store's accessToken directly via calToken()/getState(),
// ignoring expiresAt entirely — a token could sit expired-but-still-present
// in the store (the read-side hooks refresh proactively on a timer, but
// nothing guarantees that timer has fired yet) and every write call would
// then 401 instead of refreshing, indistinguishable from "not connected".
export async function ensureValidCalendarToken(): Promise<string | null> {
  const { accessToken, expiresAt, setAccessToken } = useCalendarStore.getState()
  if (accessToken && (!expiresAt || Date.now() < expiresAt - 60_000)) return accessToken
  try {
    const fresh = await refreshCalendarToken(supabase)
    setAccessToken(fresh.access_token, fresh.expires_in)
    return fresh.access_token
  } catch {
    return null // never connected, or the refresh itself failed — either way, no usable token
  }
}

// Remote-first removal of a linked Calendar event — the ONE place every
// delete/unlink path (deleteTimeBlock, deleteTask; updateTimeBlock's own
// explicit-unlink branch has its own richer no-token handling and is left
// as-is) goes through. Throws whenever the remote outcome can't be
// confirmed, on purpose: a caller must never proceed to drop its own local
// pointer to an event it couldn't verify is actually gone — both
// deleteTimeBlock and deleteTask used to do exactly that (no token, or a
// non-404 delete failure, and the local delete still went ahead regardless),
// leaving the remote event a permanent, untracked orphan.
export async function ensureLinkedCalendarEventRemoved(eventId: string): Promise<void> {
  const token = await ensureValidCalendarToken()
  if (!token) throw new Error("Can't verify or remove the linked Google Calendar event — no valid Calendar connection")
  try {
    await deleteCalendarEvent(token, 'primary', eventId)
  } catch (err) {
    if (!isCalendarNotFound(err)) throw new Error(`Couldn't remove the Google Calendar event: ${(err as Error).message}`)
  }
}
