// The Google sign-in's access token (Google Tasks since Google Calendar went, 25.11.2026): restored when the app
// opens and refreshed before it runs out. The store keeps it as `accessToken` (useCalendarStore, its old name).
import { useEffect, useRef } from 'react'
import { useCalendarStore } from '../../../app/store'
import { supabase } from '../../../integrations/supabase/client'
import { refreshCalendarToken } from '../api/calendarApi'

const REFRESH_THRESHOLD_MS = 5 * 60_000  // refresh when ≤5 min remaining

// Silently restore or refresh the Google access token.
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
      // 'not_connected' is expected when the user hasn't connected Google yet
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
