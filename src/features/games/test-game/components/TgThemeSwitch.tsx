import { Fragment, type ReactNode } from 'react'
import { MenuItem } from '@headlessui/react'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useThemeStore, type ThemePreference } from '../../../../app/store'

const THEMES: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'system', label: 'Match system theme', Icon: Monitor },
]

/**
 * Light / Dark / System as three icons side by side. Inside a Headless UI
 * menu (`inMenu`) each icon is a MenuItem, so arrow keys reach it and a pick
 * closes the menu like any other item.
 */
export function TgThemeSwitch({ inMenu = false, className = '' }: { inMenu?: boolean; className?: string }) {
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)

  return (
    <div role="group" aria-label="Theme" className={`tg-theme-switch ${className}`}>
      {THEMES.map(({ value, label, Icon }) => {
        const button: ReactNode = (
          <button
            type="button"
            aria-label={label}
            aria-pressed={theme === value}
            title={label}
            onClick={() => setTheme(value)}
            className={`tg-theme-btn ${theme === value ? 'is-active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.9} aria-hidden />
          </button>
        )
        return inMenu ? <MenuItem key={value}>{button}</MenuItem> : <Fragment key={value}>{button}</Fragment>
      })}
    </div>
  )
}
