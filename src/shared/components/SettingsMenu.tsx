import { Link } from 'react-router-dom'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { Sun, Moon, Monitor, Check, Bell, BellOff, Plug, Code2, LogOut, UserRound } from 'lucide-react'
import { useThemeStore, type ThemePreference } from '../../app/store'
import { ACCENTS, type AccentName } from '../theme/accent'
import { signOut } from '../../security/supabaseClient'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useAuth } from '../hooks/useAuth'
import { cx } from '../ui/cx'

// Settings live in two places with the same parts: this avatar menu (top bar,
// phone header) and the phone More sheet. Connect/disconnect stays in
// Developer → Connections; both only link there.

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** Light / Dark / System as a 3-icon segmented switch. */
export function ThemeSwitch({ block }: { block?: boolean }) {
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cx('grid grid-cols-3 gap-1 rounded-row border border-line bg-surface-2 p-[3px]', block ? 'w-full' : 'inline-grid')}
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const on = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cx(
              'grid h-9 min-w-10 place-items-center rounded-[9px] transition-colors duration-100 [@media(pointer:coarse)]:h-11',
              on ? 'bg-accent-50 text-accent-700 shadow-[inset_0_0_0_1px_rgb(var(--accent-500)/0.35)]' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

/** Accent colour picker: 36px swatches (44px on touch); the picked one carries a check. */
export function AccentSwatches() {
  const accent = useThemeStore(s => s.accent)
  const setAccent = useThemeStore(s => s.setAccent)
  return (
    <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-1">
      {(Object.entries(ACCENTS) as [AccentName, (typeof ACCENTS)[AccentName]][]).map(([name, preset]) => {
        const on = accent === name
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={preset.label}
            title={preset.label}
            onClick={() => setAccent(name)}
            className="grid h-9 w-9 place-items-center rounded-full [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <span
              // The hairline keeps a dark swatch (Slate) visible on the dark surface.
              className={cx('grid h-6 w-6 place-items-center rounded-full border border-line-strong ring-offset-2 ring-offset-surface', on && 'ring-2 ring-line-strong')}
              style={{ backgroundColor: preset.hex }}
            >
              {on && <Check className="h-3.5 w-3.5" style={{ color: `rgb(${preset.onAccent})` }} strokeWidth={3} aria-hidden />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Web Push toggle, or why it isn't available here. `className` styles the button row. */
export function NotificationsControl({ className = 'menu-item' }: { className?: string }) {
  const push = usePushNotifications()
  if (!push.supported) {
    return (
      <p className="px-2.5 py-1.5 text-meta text-fg-muted">
        Notifications aren't supported here. On iOS, add the site to your Home Screen first.
      </p>
    )
  }
  const Icon = push.enabled ? BellOff : Bell
  return (
    <>
      <button
        type="button"
        onClick={() => (push.enabled ? push.disable() : push.enable())}
        disabled={push.busy}
        className={cx(className, 'disabled:opacity-50')}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
        <span className="flex-1 text-left">{push.busy ? 'Working…' : push.enabled ? 'Turn off notifications' : 'Turn on notifications'}</span>
      </button>
      {push.enabled && <p className="px-2.5 pb-1 text-meta text-fg-muted">Your morning brief arrives on the lock screen.</p>}
    </>
  )
}

type User = ReturnType<typeof useAuth>['user']

function initialOf(user: User): string {
  const meta = user?.user_metadata as Record<string, unknown> | undefined
  const name = typeof meta?.full_name === 'string' ? meta.full_name : ''
  const source = name || (user?.email ?? '')
  return (source.trim()[0] ?? '').toUpperCase()
}

/** 36px round avatar: the account's initial on the accent tint. */
export function UserAvatar({ user }: { user: User }) {
  const initial = initialOf(user)
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-50 text-ui font-semibold text-accent-700 ring-1 ring-line-strong">
      {initial || <UserRound className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />}
    </span>
  )
}

export function SettingsMenu() {
  const { user } = useAuth()

  return (
    <Menu>
      <MenuButton aria-label="Settings and account" title="Settings" className="grid h-11 w-11 shrink-0 place-items-center rounded-full">
        <UserAvatar user={user} />
      </MenuButton>

      <MenuItems
        anchor={{ to: 'bottom end', gap: 8, padding: 12 }}
        transition
        className="menu w-[min(19rem,calc(100vw-24px))] origin-top-right transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
      >
        {user?.email && (
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="text-micro text-fg-faint">Signed in as</p>
            <p className="truncate text-body font-semibold text-fg">{user.email}</p>
          </div>
        )}
        <div className="menu-sep" />

        <p className="menu-label">Appearance</p>
        <div className="px-2.5 pb-2"><ThemeSwitch block /></div>

        <p className="menu-label">Accent</p>
        <div className="px-1.5 pb-1.5"><AccentSwatches /></div>

        <div className="menu-sep" />
        <NotificationsControl />
        <div className="menu-sep" />

        <MenuItem>
          <Link to="/developer?tab=connections" className="menu-item">
            <Plug className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />Connections
          </Link>
        </MenuItem>
        <MenuItem>
          <Link to="/developer" className="menu-item">
            <Code2 className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />Developer
          </Link>
        </MenuItem>
        <div className="menu-sep" />
        <MenuItem>
          <button type="button" onClick={() => signOut()} className="menu-item">
            <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />Sign out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
