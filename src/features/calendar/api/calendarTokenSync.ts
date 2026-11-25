// Deliberately SEPARATE from calendarApi.ts (which stays import-free of the live supabase client / Zustand store
// singletons): this file holds the helper that genuinely needs them.
import { supabase } from '../../../integrations/supabase/client'
import { useCalendarStore } from '../../../app/store'
import { refreshCalendarToken } from './calendarApi'

// A Google access token that is actually still valid, refreshing it if not — for every plain async call outside a
// component (the Google Tasks api, its outbox drain). Never the stored token as is: a token could sit
// expired-but-still-present in the store (useAutoRefreshCalendarToken refreshes on a timer, but nothing guarantees
// that timer has fired yet) and every call would then 401 instead of refreshing, indistinguishable from "not connected".
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
