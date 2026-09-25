import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { STATUSES } from '../../gamesMeta'
import { STATUS_TEXT, type TgGame } from '../testGameModel'
import type { PlayStatus } from '../../types'
import { useDetailState } from './TgDetailState'
import { TgStatusIcon } from './TgStatusIcon'

const PICKER = STATUSES as PlayStatus[]
// `!` because testGame.css loads after Tailwind and wins equal-specificity ties.
// Harmless next to the stylesheet's own coarse-pointer menu rule.
const COARSE_44 = '[@media(pointer:coarse)]:!min-h-[44px]'
const ITEM = `tg-menu-item ${COARSE_44}`

/** The detail panel's "◉ Playing ▾" pill: pick a status, or hide the game. */
export function TgStatusMenu({ game, className = '' }: { game: TgGame; className?: string }) {
  const { status, hiddenByStatus, autoHidden, setStatus } = useDetailState(game)
  // A Steam app that is not a game hides itself while its status is
  // "undecided" (Backlog). Unhide writes Backlog, so for these it would do
  // nothing — the menu asks for a deliberate status instead.
  const notAGame = game.notAGame
  const mustDecide = autoHidden || (notAGame && hiddenByStatus)
  const label = STATUS_TEXT[status] + (autoHidden ? ' (hidden automatically)' : '')

  return (
    // A flex wrapper so the inline-flex pill sits on no line box (no baseline gap).
    <Menu as="div" className={`flex ${className}`}>
      <MenuButton
        data-status={status}
        aria-label={`Status: ${label}. Change status`}
        className={`tg-status-pill w-[168px] max-w-full ${COARSE_44}`}
      >
        <TgStatusIcon status={status} size={14} />
        <span className="truncate">{STATUS_TEXT[status]}</span>
        {autoHidden && <EyeOff aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} />}
        <ChevronDown aria-hidden className="ml-auto h-4 w-4 shrink-0" strokeWidth={2} />
      </MenuButton>

      <MenuItems
        anchor={{ to: 'bottom start', gap: 6 }}
        transition
        className="tg-portal tg-menu w-[var(--button-width)] min-w-[220px] origin-top transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        {PICKER.map(s => (
          <MenuItem key={s}>
            <button type="button" className={`${ITEM} ${s === status ? 'is-active' : ''}`} onClick={() => setStatus(s)}>
              <TgStatusIcon status={s} size={13} />
              <span className="flex-1">{STATUS_TEXT[s]}</span>
              {s === status
                ? <Check aria-hidden className="h-4 w-4" strokeWidth={2.25} />
                : notAGame && s === 'backlog' && <span className="text-[11px] text-[var(--tg-muted)]">Hides it</span>}
            </button>
          </MenuItem>
        ))}
        <div className="tg-menu-sep" role="separator" />
        {mustDecide ? (
          <p className="max-w-[260px] px-2.5 py-2 text-[12px] leading-snug text-[var(--tg-muted)]">
            {autoHidden ? 'Hidden automatically: ' : 'Hidden: '}
            Steam does not list this as a game. Pick Playing, Completed, Wishlist or Dropped to show it in the library.
          </p>
        ) : (
          <MenuItem>
            <button type="button" className={ITEM} onClick={() => setStatus(hiddenByStatus ? 'backlog' : 'hidden')}>
              {hiddenByStatus
                ? <Eye aria-hidden className="h-4 w-4" strokeWidth={1.9} />
                : <EyeOff aria-hidden className="h-4 w-4" strokeWidth={1.9} />}
              <span>{hiddenByStatus ? 'Unhide' : 'Hide game'}</span>
            </button>
          </MenuItem>
        )}
      </MenuItems>
    </Menu>
  )
}
