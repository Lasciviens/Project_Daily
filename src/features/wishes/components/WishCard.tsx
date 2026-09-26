import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowRight, CalendarPlus, Check, ExternalLink, MapPin, MoreHorizontal, Pencil, Trash2, Undo2, Ban } from 'lucide-react'
import { ToneDot, TonePill } from '../../../shared/ui'
import { resolveWishWindow, wishPeriodLabel } from '../wishRules'
import { SCHEDULED_TONE, WINDOW_TONE, WISH_PRIORITY_TONE } from '../wishTones'
import type { WishItem, WishStatus } from '../types'

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
    <div className={`card flex flex-col gap-2 p-3 ${isClosed ? 'opacity-60' : state === 'passed' ? 'opacity-80' : ''}`}>
      <div className="flex items-start gap-2">
        <ToneDot tone={WISH_PRIORITY_TONE[wish.priority]} className="mt-[7px]" />
        <div className="min-w-0 flex-1">
          <p className={`text-ui font-semibold leading-snug text-fg ${isDone ? 'line-through' : ''}`}>
            {wish.kind === 'place' && <MapPin aria-label="Place" className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-fg-muted" />}
            {wish.title}
          </p>
          {wish.notes && <p className="mt-0.5 line-clamp-2 text-meta text-fg-muted">{wish.notes}</p>}
        </div>

        {/* One menu at every width, so phones reach the same actions. */}
        <Menu as="div" className="-mr-1 -mt-1 shrink-0">
          <MenuButton className="icon-btn" aria-label="More actions" title="More actions">
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition
            className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            <MenuItem>
              <button type="button" onClick={onEdit} className="menu-item"><Pencil aria-hidden className="h-4 w-4" /> Edit</button>
            </MenuItem>
            <MenuItem>
              {wish.status === 'dropped' ? (
                <button type="button" onClick={() => onStatus('idea')} className="menu-item"><Undo2 aria-hidden className="h-4 w-4" /> Put back</button>
              ) : (
                <button type="button" onClick={() => onStatus('dropped')} className="menu-item"><Ban aria-hidden className="h-4 w-4" /> Not any more</button>
              )}
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem>
              <button type="button" onClick={onDelete} className="menu-item is-danger"><Trash2 aria-hidden className="h-4 w-4" /> Delete</button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>

      <div className="ml-4 flex flex-wrap items-center gap-1.5">
        {period && <TonePill tone={WINDOW_TONE[state]}>{period}</TonePill>}
        {wish.status === 'planned' && (
          <span title="A task was created from this wish — the wish stays here as the memory">
            <TonePill tone={SCHEDULED_TONE}><ArrowRight aria-hidden className="h-3 w-3" /> scheduled</TonePill>
          </span>
        )}
        {wish.status === 'dropped' && <TonePill tone="neutral">Not any more</TonePill>}
        {place && <span className="chip">{place}</span>}
        {wish.url && (
          <a href={wish.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-meta font-semibold text-accent-600 hover:text-accent-700">
            Link <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line pt-1.5">
        <button type="button" onClick={() => onStatus(isDone ? 'idea' : 'done')}
          className="btn-ghost btn-sm flex-1 justify-center">
          {isDone ? <><Undo2 aria-hidden className="h-4 w-4" /> Not done yet</> : <><Check aria-hidden className="h-4 w-4" /> Done</>}
        </button>
        {!isClosed && (
          <button type="button" onClick={onPlan} title="Turn it into a real task — the wish stays on this list"
            className="btn-ghost btn-sm flex-1 justify-center text-accent-600">
            <CalendarPlus aria-hidden className="h-4 w-4" /> Plan it
          </button>
        )}
      </div>
    </div>
  )
}
