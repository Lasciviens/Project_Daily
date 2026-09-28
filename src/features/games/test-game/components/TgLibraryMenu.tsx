import { useState } from 'react'
import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from '@headlessui/react'
import { Ellipsis, Plus } from 'lucide-react'
import { TgConnections } from './TgConnections'
import { TgPsnRenewDialog } from './TgPsnRenewDialog'
import { TgRefreshIcon } from './TgRefreshLibrary'
import { useRefreshLibraryAction } from './useRefreshLibraryAction'
import { useTgAddGame } from './tgAddGame'

const ICON = 'h-4 w-4 shrink-0'

/**
 * The library's ⋯ menu (the toolbar's end, and the phone's section row):
 * Refresh library, and PlayStation / Steam status with PSN renew (owner
 * request 2026-09-25 — first-time connect and disconnect stay in Developer →
 * Connections). Theme and account live in the app's own ⚙ menu.
 */
export function TgLibraryMenu({ className = '', withAddGame = false }: { className?: string; withAddGame?: boolean }) {
  // Outside the menu: picking "Renew token" closes the menu, the dialog stays.
  const [renewOpen, setRenewOpen] = useState(false)
  const refresh = useRefreshLibraryAction()
  const openAddGame = useTgAddGame(s => s.setOpen)

  return (
    <>
      <Menu>
        <MenuButton aria-label="Library options" title="Library options" className={`tg-icon-btn shrink-0 ${className}`}>
          <Ellipsis aria-hidden size={20} strokeWidth={1.9} />
        </MenuButton>
        <MenuItems
          anchor={{ to: 'bottom end', gap: 6, padding: 12 }}
          transition
          className="tg-portal tg-menu w-[min(19rem,calc(100vw-24px))] transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
        >
          {withAddGame && (
            <MenuItem>
              <button type="button" onClick={() => openAddGame(true)} className="tg-menu-item">
                <Plus aria-hidden className={ICON} strokeWidth={1.9} />
                Add game
              </button>
            </MenuItem>
          )}
          <MenuItem>
            <button type="button" onClick={() => { void refresh.run() }} className="tg-menu-item">
              <TgRefreshIcon busy={refresh.busy} />
              Refresh library
            </button>
          </MenuItem>
          <MenuSeparator className="tg-menu-sep" />
          <MenuSection>
            <MenuHeading className="tg-menu-label">Connections</MenuHeading>
            {/* MenuItems only render while open, so these fetch on open only. */}
            <div className="px-1 pb-1"><TgConnections inMenu onRenewPsn={() => setRenewOpen(true)} /></div>
          </MenuSection>
        </MenuItems>
      </Menu>
      <TgPsnRenewDialog open={renewOpen} onClose={() => setRenewOpen(false)} />
    </>
  )
}
