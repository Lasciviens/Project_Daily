import { useState } from 'react'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore } from '../../app/store'
import { supabase } from '../../integrations/supabase/client'
import { exchangeCalendarCode, disconnectCalendar } from '../../features/calendar/api/calendarApi'
import { useAutoRefreshCalendarToken } from '../../features/calendar/hooks/useCalendar'
import { applyTheme } from './ThemeSwitcher'
import { signOut } from '../../security/supabaseClient'

const THEMES: Record<string, { label: string; hex: string }> = {
  orange: { label: 'Orange', hex: '#f59e0b' },
  red:    { label: 'Red',    hex: '#ef4444' },
  blue:   { label: 'Blue',   hex: '#3b82f6' },
  purple: { label: 'Purple', hex: '#8b5cf6' },
  yellow: { label: 'Yellow', hex: '#eab308' },
  black:  { label: 'Black',  hex: '#1f2937' },
}

export function SettingsMenu() {
  const [calLoading, setCalLoading] = useState(false)
  const [calError,   setCalError]   = useState<string | null>(null)
  const [theme,      setTheme]      = useState(() => localStorage.getItem('accent-theme') ?? 'orange')

  const { accessToken, expiresAt, setAccessToken } = useCalendarStore()
  useAutoRefreshCalendarToken()

  const isCalConnected = !!accessToken && (!expiresAt || Date.now() < expiresAt - 60_000)

  const login = useGoogleLogin({
    flow:    'auth-code',
    scope:   'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks',
    ux_mode: 'popup',
    onSuccess: async ({ code }) => {
      setCalLoading(true)
      setCalError(null)
      try {
        const { access_token, expires_in } = await exchangeCalendarCode(supabase, code)
        setAccessToken(access_token, expires_in)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Connection failed'
        setCalError(msg === 'no_refresh_token' ? 'Please reconnect and allow access again.' : msg)
      } finally {
        setCalLoading(false)
      }
    },
    onError: () => setCalError('Sign-in was cancelled or failed'),
  })

  async function handleDisconnect() {
    setCalLoading(true)
    setAccessToken(null)  // clear immediately so UI reacts at once
    try { await disconnectCalendar(supabase) } catch { /* server cleanup best-effort */ }
    setCalLoading(false)
  }

  function selectTheme(name: string) {
    applyTheme(name)
    localStorage.setItem('accent-theme', name)
    setTheme(name)
  }

  return (
    /* Menu handles keyboard navigation, portal, and click-outside — no manual listeners needed */
    <Menu>
      <MenuButton
        title="Settings"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-lg transition-colors duration-150 text-ink-400 hover:text-ink-700 hover:bg-ink-100 data-[open]:bg-ink-100 data-[open]:text-ink-700"
      >
        ⚙
      </MenuButton>

      <MenuItems
        anchor="bottom end"
        transition
        className="z-50 bg-white border border-ink-200 rounded-xl shadow-card-hover w-60 overflow-hidden [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0 data-[closed]:scale-95"
      >
        {/* Google Calendar */}
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2.5">Google Calendar</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isCalConnected ? 'bg-green-400' : 'bg-ink-300'}`} />
              <span className="text-xs text-ink-600">{isCalConnected ? 'Connected' : 'Not connected'}</span>
            </div>
            {isCalConnected ? (
              <MenuItem>
                <button
                  onClick={handleDisconnect}
                  disabled={calLoading}
                  className="text-[11px] text-red-400 hover:text-red-600 font-medium transition-colors duration-150 disabled:opacity-50"
                >
                  {calLoading ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </MenuItem>
            ) : (
              <MenuItem>
                <button
                  onClick={() => { setCalError(null); login() }}
                  disabled={calLoading}
                  className="text-[11px] text-accent-600 hover:text-accent-700 font-medium transition-colors duration-150 disabled:opacity-50"
                >
                  {calLoading ? 'Connecting…' : 'Connect'}
                </button>
              </MenuItem>
            )}
          </div>
          {calError && <p className="text-[10px] text-red-400 mt-1.5 leading-snug">{calError}</p>}
        </div>

        {/* Theme */}
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2.5">Theme</p>
          <div className="flex items-center gap-2">
            {Object.entries(THEMES).map(([name, t]) => (
              <MenuItem key={name}>
                <button
                  onClick={() => selectTheme(name)}
                  title={t.label}
                  className={`w-5 h-5 rounded-full border-2 transition-all duration-150 hover:scale-110 ${
                    theme === name ? 'border-ink-500 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: t.hex }}
                />
              </MenuItem>
            ))}
          </div>
        </div>

        {/* Sign out */}
        <MenuItem>
          <button
            onClick={() => signOut()}
            className="w-full px-4 py-3 text-left text-sm text-ink-500 hover:bg-cream-50 hover:text-red-500 transition-colors duration-150 data-[focus]:bg-cream-50 data-[focus]:text-red-500"
          >
            Sign out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
