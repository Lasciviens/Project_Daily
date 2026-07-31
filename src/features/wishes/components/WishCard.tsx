import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { resolveWishWindow, wishPeriodLabel, type WishWindowState } from '../wishRules'
import type { WishItem, WishStatus } from '../types'

const PRIORITY_DOT: Record<WishItem['priority'], string> = {
  low: 'bg-ink-300', medium: 'bg-accent-400', high: 'bg-red-400',
}

// A period is a reminder, never a deadline — so a PASSED window is grey, the
// same weight as "anytime". Never red, never an overdue mark: only the user
// closes a wish, by ticking or deleting it.
const PERIOD_CHIP: Record<WishWindowState, string> = {
  open:     'bg-accent-50 text-accent-600',
  upcoming: 'bg-ink-100 text-ink-600',
  passed:   'bg-ink-100 text-ink-400',
  anytime:  'bg-ink-100 text-ink-500',
}

const MENU_ITEM = 'w-full text-left px-3 min-h-[44px] text-sm data-[focus]:bg-ink-100'

interface Props {
  wish:      WishItem
  today:     string
  onEdit:    () => void
  onPlan:    () => void
  onStatus:  (status: WishStatus) => void
  onDelete:  () => void
}

export function WishCard({ wish, today, onEdit, onPlan, onStatus, onDelete }: Props) {
  const state    = resolveWishWindow(wish, today)
  const period   = wishPeriodLabel(wish)
  const isDone   = wish.status === 'done'
  const isClosed = isDone || wish.status === 'dropped'
  const place    = [wish.city, wish.country].filter(Boolean).join(', ')

  return (
    <div className={`flex flex-col gap-2 rounded-2xl border border-ink-200 bg-cream-50 p-3 ${
      isClosed ? 'opacity-60' : state === 'passed' ? 'opacity-80' : ''
    }`}>
      <div className="flex items-start gap-2">
        <span className={`mt-[7px] h-2 w-2 flex-shrink-0 rounded-full ${PRIORITY_DOT[wish.priority]}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold leading-snug text-ink-900 ${isDone ? 'line-through' : ''}`}>
            {wish.kind === 'place' && <span aria-hidden className="mr-1">📍</span>}
            {wish.title}
          </p>
          {wish.notes && <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{wish.notes}</p>}
        </div>

        {/* One ⋯ menu at every width (not a hover-only strip) so the secondary
            actions have the same reachable path on a phone as on a desktop. */}
        <Menu as="div" className="flex-shrink-0">
          <MenuButton
            className="press-feedback flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lg leading-none text-ink-400 hover:text-ink-700"
            title="More actions"
            aria-label="More actions"
          >
            ⋯
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            transition
            className="z-[60] w-44 overflow-hidden rounded-xl border border-ink-200 bg-cream-50 shadow-card-hover [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0"
          >
            <MenuItem>
              <button onClick={onEdit} className={`${MENU_ITEM} text-ink-700`}>✎ Edit</button>
            </MenuItem>
            <MenuItem>
              {wish.status === 'dropped' ? (
                <button onClick={() => onStatus('idea')} className={`${MENU_ITEM} text-ink-700`}>↩ Put back</button>
              ) : (
                <button onClick={() => onStatus('dropped')} className={`${MENU_ITEM} text-ink-600`}>⊘ Not any more</button>
              )}
            </MenuItem>
            <MenuItem>
              <button onClick={onDelete} className={`${MENU_ITEM} text-red-600`}>✕ Delete</button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>

      <div className="ml-4 flex flex-wrap items-center gap-1.5">
        {period && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PERIOD_CHIP[state]}`}>
            {period}
          </span>
        )}
        {wish.status === 'planned' && (
          <span
            className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-600"
            title="A task was created from this wish — the wish stays here as the memory"
          >
            → scheduled
          </span>
        )}
        {wish.status === 'dropped' && (
          <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-400">Not any more</span>
        )}
        {place && (
          <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">{place}</span>
        )}
        {wish.url && (
          <a
            href={wish.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-500 underline hover:text-blue-700"
          >
            Link ↗
          </a>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-ink-100 pt-1.5">
        <button
          onClick={() => onStatus(isDone ? 'idea' : 'done')}
          className="press-feedback min-h-[44px] flex-1 rounded-lg text-[11px] font-medium text-ink-600 transition-colors hover:bg-cream-100"
        >
          {isDone ? '↩ Not done yet' : '✓ Done'}
        </button>
        {!isClosed && (
          <button
            onClick={onPlan}
            className="press-feedback min-h-[44px] flex-1 rounded-lg text-[11px] font-medium text-accent-600 transition-colors hover:bg-accent-50"
            title="Turn it into a real task — the wish stays on this list"
          >
            + Plan it
          </button>
        )}
      </div>
    </div>
  )
}
