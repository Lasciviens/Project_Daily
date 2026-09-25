import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { STATUSES } from '../../gamesMeta'
import { STATUS_TEXT, type TgGame } from '../testGameModel'
import type { PlayStatus } from '../../types'
import { useDetailState } from './TgDetailState'

const PICKER = STATUSES as PlayStatus[]
// `!` because testGame.css loads after Tailwind and wins equal-specificity ties.
const COARSE_44 = '[@media(pointer:coarse)]:!min-h-[44px]'
const ITEM = `tg-menu-item ${COARSE_44}`
// The design's pill dot is a ring ("◉"), the menu's are plain dots.
const RING_DOT = { width: 12, height: 12, background: 'transparent', boxShadow: 'inset 0 0 0 3.5px var(--st)' }

/** The detail panel's "● Playing ▾" pill: pick a status, or hide the game. */
export function TgStatusMenu({ game, className = '' }: { game: TgGame; className?: string }) {
  const { status, hiddenByStatus, autoHidden, setStatus } = useDetailState(game)

  return (
    // A flex wrapper so the inline-flex pill sits on no line box (no baseline gap).
    <Menu as="div" className={`flex ${className}`}>
      <MenuButton
        data-status={status}
        aria-label={`Status: ${STATUS_TEXT[status]}. Change status`}
        className={`tg-status-pill w-[168px] max-w-full ${COARSE_44}`}
      >
        <span className="tg-dot" style={RING_DOT} />
        <span className="truncate">{STATUS_TEXT[status]}</span>
        <ChevronDown aria-hidden className="ml-auto h-4 w-4 shrink-0" strokeWidth={2} />
      </MenuButton>

      <MenuItems
        anchor={{ to: 'bottom start', gap: 6 }}
        transition
        className="tg-portal tg-menu w-[var(--button-width)] min-w-[200px] origin-top transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        {PICKER.map(s => (
          <MenuItem key={s}>
            <button type="button" className={`${ITEM} ${s === status ? 'is-active' : ''}`} onClick={() => setStatus(s)}>
              <span className="tg-dot" data-status={s} />
              <span className="flex-1">{STATUS_TEXT[s]}</span>
              {s === status && <Check aria-hidden className="h-4 w-4" strokeWidth={2.25} />}
            </button>
          </MenuItem>
        ))}
        <div className="tg-menu-sep" role="separator" />
        {autoHidden ? (
          <p className="px-2.5 py-2 text-[12px] leading-snug text-[var(--tg-muted)]">
            Hidden automatically: Steam does not list this as a game. Mark it Playing, Completed, Wishlist or Dropped to keep it in the library.
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
