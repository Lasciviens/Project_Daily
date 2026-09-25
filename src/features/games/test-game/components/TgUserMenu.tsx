import { useState } from 'react'
import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from '@headlessui/react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../../shared/hooks/useAuth'
import { useTestGameStore } from '../testGameStore'
import { TgUserMenuAvatar } from './TgUserMenuAvatar'
import { TgThemeSwitch } from './TgThemeSwitch'
import { TgConnections } from './TgConnections'
import { TgPsnRenewDialog } from './TgPsnRenewDialog'

const ICON = 'h-4 w-4 shrink-0'

/** The round account avatar and its menu (desktop top bar and phone header). */
export function TgUserMenu({ className = '' }: { className?: string }) {
  const { user } = useAuth()
  const setSection = useTestGameStore(s => s.setSection)
  const navigate = useNavigate()
  // Outside the menu: picking "Renew token" closes the menu, the dialog stays.
  const [renewOpen, setRenewOpen] = useState(false)

  return (
    <>
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
          className="tg-portal tg-menu w-[min(19rem,calc(100vw-24px))] transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="text-[11px] font-medium text-[var(--tg-faint)]">Signed in as</div>
            <div className="truncate text-[13px] font-semibold text-[var(--tg-text)]" title={user?.email ?? undefined}>
              {user?.email ?? '…'}
            </div>
          </div>
          <MenuSeparator className="tg-menu-sep" />
          <div className="flex items-center justify-between gap-3 py-1 pl-2.5 pr-1">
            <span className="tg-menu-label !p-0">Theme</span>
            <TgThemeSwitch inMenu />
          </div>
          <MenuSeparator className="tg-menu-sep" />
          <MenuSection>
            <MenuHeading className="tg-menu-label">Connections</MenuHeading>
            {/* MenuItems only render while open, so these fetch on open only. */}
            <div className="px-1 pb-1"><TgConnections inMenu onRenewPsn={() => setRenewOpen(true)} /></div>
          </MenuSection>
          <MenuSeparator className="tg-menu-sep" />
          <MenuItem>
            <button type="button" onClick={() => setSection('advanced')} className="tg-menu-item">
              <SlidersHorizontal aria-hidden className={ICON} strokeWidth={1.9} />
              Advanced tools
            </button>
          </MenuItem>
          <MenuItem>
            <button type="button" onClick={() => navigate('/home')} className="tg-menu-item">
              <ArrowLeft aria-hidden className={ICON} strokeWidth={1.9} />
              Back to Lasci&apos;s Board
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
      <TgPsnRenewDialog open={renewOpen} onClose={() => setRenewOpen(false)} />
    </>
  )
}
