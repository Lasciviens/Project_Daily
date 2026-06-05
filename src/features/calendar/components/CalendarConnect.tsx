import { useState } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore } from '../../../app/store'
import { supabase } from '../../../integrations/supabase/client'
import { exchangeCalendarCode, disconnectCalendar } from '../api/calendarApi'
import { useAutoRefreshCalendarToken } from '../hooks/useCalendar'

// Reconnect with prompt=consent to force Google to return a fresh refresh_token
const CONSENT_HINT = 'no_refresh_token'

export function CalendarConnect() {
  const { accessToken, expiresAt, setAccessToken } = useCalendarStore()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Attempt silent token restore on mount and auto-refresh when near expiry
  useAutoRefreshCalendarToken()

  const isValid = !!accessToken && (!expiresAt || Date.now() < expiresAt - 60_000)

  const login = useGoogleLogin({
    flow:  'auth-code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    // postmessage redirect works for SPAs that can't host a redirect page
    ux_mode: 'popup',
    onSuccess: async ({ code }) => {
      setLoading(true)
      setError(null)
      try {
        const { access_token, expires_in } = await exchangeCalendarCode(supabase, code)
        setAccessToken(access_token, expires_in)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Connection failed'
        // Guide user to re-authorise if Google didn't return a refresh_token
        setError(msg === CONSENT_HINT ? 'Please reconnect and allow access again.' : msg)
      } finally {
        setLoading(false)
      }
    },
    onError: () => setError('Google sign-in was cancelled or failed'),
  })

  async function handleDisconnect() {
    setLoading(true)
    setError(null)
    try {
      await disconnectCalendar(supabase)
      setAccessToken(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Disconnect failed')
    } finally {
      setLoading(false)
    }
  }

  if (isValid) {
    return (
      <button
        onClick={handleDisconnect}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700 transition-colors duration-150 disabled:opacity-50"
        title="Disconnect Google Calendar"
      >
        <span className="w-2 h-2 rounded-full bg-green-400" />
        {loading ? 'Disconnecting…' : 'Calendar'}
      </button>
    )
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={() => { setError(null); login() }}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150 disabled:opacity-50"
        title="Connect Google Calendar"
      >
        <span className="w-2 h-2 rounded-full bg-ink-200" />
        {loading ? 'Connecting…' : 'Calendar'}
      </button>
      {error && (
        <span className="text-[10px] text-red-400 max-w-[160px] leading-tight">{error}</span>
      )}
    </div>
  )
}
