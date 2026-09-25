import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from '@headlessui/react'
import { ArrowLeft, Check, Monitor, Moon, SlidersHorizontal, Sun, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useThemeStore, type ThemePreference } from '../../../../app/store'
import { useAuth } from '../../../../shared/hooks/useAuth'
import { useTestGameStore } from '../testGameStore'
import { TgUserMenuAvatar } from './TgUserMenuAvatar'

const THEMES: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

const ICON = 'h-4 w-4 shrink-0'

/** The round account avatar and its menu (desktop top bar and phone header). */
export function TgUserMenu({ className = '' }: { className?: string }) {
  const { user } = useAuth()
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  const setSection = useTestGameStore(s => s.setSection)
  const navigate = useNavigate()

  return (
    <Menu>
      <MenuButton
        aria-label="Account menu"
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity [@media(hover:hover)]:hover:opacity-90 ${className}`}
      >
        <TgUserMenuAvatar user={user} />
      </MenuButton>
      <MenuItems
        anchor={{ to: 'bottom end', gap: 6, padding: 12 }}
        transition
        className="tg-portal tg-menu w-64 transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="text-[11px] font-medium text-[var(--tg-faint)]">Signed in as</div>
          <div className="truncate text-[13px] font-semibold text-[var(--tg-text)]" title={user?.email ?? undefined}>
            {user?.email ?? '…'}
          </div>
        </div>
        <MenuSeparator className="tg-menu-sep" />
        <MenuSection>
          <MenuHeading className="tg-menu-label">Theme</MenuHeading>
          {THEMES.map(t => (
            <MenuItem key={t.value}>
              <button
                type="button"
                onClick={() => setTheme(t.value)}
                className={`tg-menu-item ${theme === t.value ? 'is-active' : ''}`}
              >
                <t.icon aria-hidden className={ICON} strokeWidth={1.9} />
                <span className="flex-1">{t.label}</span>
                {theme === t.value && <Check aria-label="Current theme" className={ICON} strokeWidth={2.2} />}
              </button>
            </MenuItem>
          ))}
        </MenuSection>
        <MenuSeparator className="tg-menu-sep" />
        <MenuItem>
          <button type="button" onClick={() => setSection('advanced')} className="tg-menu-item">
            <SlidersHorizontal aria-hidden className={ICON} strokeWidth={1.9} />
            Advanced tools
          </button>
        </MenuItem>
        <MenuItem>
          <button type="button" onClick={() => navigate('/games')} className="tg-menu-item">
            <ArrowLeft aria-hidden className={ICON} strokeWidth={1.9} />
            Back to Lasci&apos;s Board
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
