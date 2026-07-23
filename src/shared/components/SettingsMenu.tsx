import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { useGoogleLogin } from '@react-oauth/google'
import { useCalendarStore, useThemeStore, type ThemePreference } from '../../app/store'
import { supabase } from '../../integrations/supabase/client'
import { exchangeCalendarCode, disconnectCalendar } from '../../features/calendar/api/calendarApi'
import { useAutoRefreshCalendarToken } from '../../features/calendar/hooks/useCalendar'
import { applyTheme, THEMES } from './ThemeSwitcher'
import { signOut } from '../../security/supabaseClient'
import { FitbitSyncButton } from '../../features/training/components/health/FitbitSyncButton'
import { usePushNotifications } from '../hooks/usePushNotifications'

export function SettingsMenu() {
  const [calLoading, setCalLoading] = useState(false)
  const [calError,   setCalError]   = useState<string | null>(null)
  const [theme,      setTheme]      = useState(() => localStorage.getItem('accent-theme') ?? 'orange')

  const { accessToken, expiresAt, setAccessToken } = useCalendarStore()
  const { theme: appearance, setTheme: setAppearance } = useThemeStore()
  const push = usePushNotifications()
  useAutoRefreshCalendarToken()

  const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'light',  label: 'Light',  icon: '☀️' },
    { value: 'dark',   label: 'Dark',   icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' },
  ]

  const isCalConnected = !!accessToken && (!expiresAt || Date.now() < expiresAt - 60_000)

  // ONE "Connect Google" = one consent covering every Google service the app
  // pulls (user decision 2026-07-21, supersedes the earlier per-service-client
  // plan): Calendar + Tasks + the three Google Health (Fitbit Air) read scopes.
  // The single refresh token stored by calendar-oauth then serves them all —
  // including the server-side google-health-sync poller. Adding a future scope
  // (Gmail briefing, contacts birthdays, …) = append here + one re-consent.
  const login = useGoogleLogin({
    flow:    'auth-code',
    scope:   [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
      'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
      'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
    ].join(' '),
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
        className="w-11 h-11 flex items-center justify-center rounded-lg text-lg transition-colors duration-150 text-ink-400 hover:text-ink-700 hover:bg-ink-100 data-[open]:bg-ink-100 data-[open]:text-ink-700"
      >
        ⚙
      </MenuButton>

      <MenuItems
        anchor="bottom end"
        transition
        className="z-50 bg-cream-50 border border-ink-200 rounded-xl shadow-card-hover w-60 overflow-hidden [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0 data-[closed]:scale-95"
      >
        {/* Google — one connection for Calendar + Tasks + Fitbit (Google Health) */}
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">Google</p>
          <p className="text-[10px] text-ink-400 mb-2.5 leading-snug">Calendar · Tasks · Fitbit (Health)</p>
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
          {isCalConnected && <div className="mt-2"><FitbitSyncButton /></div>}
        </div>

        {/* Notifications (Web Push) */}
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Bildirimler</p>
          {push.supported ? (
            <button
              onClick={() => (push.enabled ? push.disable() : push.enable())}
              disabled={push.busy}
              className="w-full min-h-[44px] rounded-lg border border-ink-200 text-sm text-ink-700 hover:border-accent-300 hover:text-accent-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {push.busy ? '…' : push.enabled ? '🔕 Bildirimleri kapat' : '🔔 Bildirimleri aç'}
            </button>
          ) : (
            <p className="text-[10px] text-ink-400 leading-snug">Bu cihazda desteklenmiyor. iOS'ta önce siteyi Ana Ekrana ekle (PWA), sonra buradan aç.</p>
          )}
          {push.enabled && <p className="text-[10px] text-ink-400 mt-1.5 leading-snug">Sabah brief'i kilit ekranına düşer.</p>}
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

        {/* Appearance (light/dark/system) */}
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2.5">Appearance</p>
          <div className="flex gap-1 p-0.5 bg-cream-100 rounded-lg">
            {APPEARANCE_OPTIONS.map(opt => (
              <MenuItem key={opt.value}>
                {({ close }) => (
                  <button
                    onClick={() => { setAppearance(opt.value); close() }}
                    title={opt.label}
                    className={`flex-1 min-h-[44px] rounded-md text-xs font-medium transition-colors duration-150 ${
                      appearance === opt.value ? 'bg-cream-50 text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    {opt.icon}
                  </button>
                )}
              </MenuItem>
            ))}
          </div>
        </div>

        {/* Developer */}
        <MenuItem>
          <Link
            to="/developer"
            className="flex items-center min-h-[44px] px-4 text-sm text-ink-700 hover:bg-cream-50 transition-colors duration-150 data-[focus]:bg-cream-50 border-b border-ink-100"
          >
            👨‍💻 Developer
          </Link>
        </MenuItem>

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
