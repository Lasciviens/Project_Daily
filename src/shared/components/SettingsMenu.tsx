import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { useThemeStore, type ThemePreference } from '../../app/store'
import { useAutoRefreshCalendarToken } from '../../features/calendar/hooks/useCalendar'
import { applyTheme, THEMES } from './ThemeSwitcher'
import { signOut } from '../../security/supabaseClient'
import { usePushNotifications } from '../hooks/usePushNotifications'

export function SettingsMenu() {
  const [theme,      setTheme]      = useState(() => localStorage.getItem('accent-theme') ?? 'orange')

  const { theme: appearance, setTheme: setAppearance } = useThemeStore()
  const push = usePushNotifications()
  // Connect/disconnect moved to Developer → Connections, but this hook must
  // stay HERE: SettingsMenu is mounted in the header on every route, so it is
  // the only always-on place the Calendar access token gets refreshed. On the
  // Connections tab it would only run while that tab happened to be open.
  useAutoRefreshCalendarToken()

  const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'light',  label: 'Light',  icon: '☀️' },
    { value: 'dark',   label: 'Dark',   icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' },
  ]

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
        {/* Notifications (Web Push) */}
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Notifications</p>
          {push.supported ? (
            <button
              onClick={() => (push.enabled ? push.disable() : push.enable())}
              disabled={push.busy}
              className="w-full min-h-[44px] rounded-lg border border-ink-200 text-sm text-ink-700 hover:border-accent-300 hover:text-accent-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {push.busy ? '…' : push.enabled ? '🔕 Turn off notifications' : '🔔 Turn on notifications'}
            </button>
          ) : (
            <p className="text-[10px] text-ink-400 leading-snug">Not supported on this device. On iOS, add the site to your Home Screen (PWA) first, then enable here.</p>
          )}
          {push.enabled && <p className="text-[10px] text-ink-400 mt-1.5 leading-snug">Your morning brief will arrive on the lock screen.</p>}
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

        {/* Where Google/Strava/PlayStation connect + disconnect now live. */}
        <MenuItem>
          <Link
            to="/developer?tab=connections"
            className="flex items-center min-h-[44px] px-4 text-sm text-ink-700 hover:bg-cream-50 transition-colors duration-150 data-[focus]:bg-cream-50 border-b border-ink-100"
          >
            🔌 Connections
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
