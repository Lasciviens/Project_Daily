import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from '@headlessui/react'
import { Check, Copy, Eye, EyeOff, Plus, Settings2 } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import { TgRefreshIcon } from './TgRefreshLibrary'
import { useRefreshLibraryAction } from './useRefreshLibraryAction'
import { useTgAddGame } from './tgAddGame'
import { useTgPlatformPrefs } from './tgPlatformPrefs'
import { useGamesPrefs } from '../../prefs/useGamesPrefs'
import { TG_VIEWS } from './tgViews'

const ICON = 'h-4 w-4 shrink-0'

/**
 * The library's settings menu (the toolbar's end, and the phone's section
 * row): Show hidden games, Find duplicates, Refresh library. PlayStation /
 * Steam status is NOT here any more (owner, 30.09.2026: it already shows on
 * the shelves' Sync buttons, Advanced and Settings → Subscriptions). Theme
 * and account live in the app's own ⚙ menu. With `views` (a toolbar too
 * narrow for the view switch) it also offers Shelf / Cover grid / List.
 */
export function TgLibraryMenu({ className = '', withAddGame = false, views = false, hiddenCount = 0 }: {
  className?: string; withAddGame?: boolean; views?: boolean
  /** Hidden games in the library — the Show hidden row appears only when there are some. */
  hiddenCount?: number
}) {
  const showHidden = useTestGameStore(s => s.showHidden)
  const setShowHidden = useTestGameStore(s => s.setShowHidden)
  const setAdvancedTab = useTestGameStore(s => s.setAdvancedTab)
  const refresh = useRefreshLibraryAction()
  const openAddGame = useTgAddGame(s => s.setOpen)
  const openPlatformPrefs = useTgPlatformPrefs(s => s.setOpen)
  const leftOut = useGamesPrefs().prefs.excludedPlatforms.length
  const view = useTestGameStore(s => s.view)
  const setView = useTestGameStore(s => s.setView)

  return (
    <>
      <Menu>
        <MenuButton aria-label="Library settings" title="Library settings" className={`tg-icon-btn shrink-0 ${className}`}>
          <Settings2 aria-hidden size={20} strokeWidth={1.9} />
        </MenuButton>
        <MenuItems
          anchor={{ to: 'bottom end', gap: 6, padding: 12 }}
          transition
          className="tg-portal tg-menu w-[min(19rem,calc(100vw-24px))] transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:opacity-0"
        >
          {views && (
            <>
              <MenuSection>
                <MenuHeading className="tg-menu-label">View</MenuHeading>
                {TG_VIEWS.map(v => (
                  <MenuItem key={v.key}>
                    <button type="button" aria-current={v.key === view ? 'true' : undefined} onClick={() => setView(v.key)} className="tg-menu-item">
                      <v.icon aria-hidden className={ICON} strokeWidth={1.9} />
                      <span className="min-w-0 flex-1 truncate">{v.menuLabel}</span>
                      <Check aria-hidden className={`${ICON} ${v.key === view ? '' : 'invisible'}`} strokeWidth={2.2} />
                    </button>
                  </MenuItem>
                ))}
              </MenuSection>
              <MenuSeparator className="tg-menu-sep" />
            </>
          )}
          {withAddGame && (
            <MenuItem>
              <button type="button" onClick={() => openAddGame(true)} className="tg-menu-item">
                <Plus aria-hidden className={ICON} strokeWidth={1.9} />
                Add game
              </button>
            </MenuItem>
          )}
          {hiddenCount > 0 && (
            <MenuItem>
              <button type="button" role="menuitemcheckbox" aria-checked={showHidden} onClick={() => setShowHidden(!showHidden)} className="tg-menu-item">
                <Eye aria-hidden className={ICON} strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">Show hidden games ({hiddenCount})</span>
                <Check aria-hidden className={`${ICON} ${showHidden ? '' : 'invisible'}`} strokeWidth={2.2} />
              </button>
            </MenuItem>
          )}
          <MenuItem>
            <button type="button" onClick={() => openPlatformPrefs(true)} className="tg-menu-item">
              <EyeOff aria-hidden className={ICON} strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate">Platforms left out of stats{leftOut ? ` (${leftOut})` : ''}…</span>
            </button>
          </MenuItem>
          <MenuItem>
            <button type="button" onClick={() => setAdvancedTab('duplicates')} className="tg-menu-item">
              <Copy aria-hidden className={ICON} strokeWidth={1.9} />
              Find duplicates
            </button>
          </MenuItem>
          <MenuItem>
            <button type="button" onClick={() => { void refresh.run() }} className="tg-menu-item">
              <TgRefreshIcon busy={refresh.busy} />
              Refresh library
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>
    </>
  )
}
