import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDown, ArrowUp, CalendarPlus, ChevronsUp, GripVertical, MoreHorizontal, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { IconButton, ToneDot, Truncate, cx } from '../../../shared/ui'
import { BUCKET_LABEL, BUCKET_TONE, type LibraryItem } from '../libraryModel'
import { queueKeyMove } from '../queue/queueModel'
import type { TraktListItem } from '../trakt/traktApi'

interface Props {
  item: TraktListItem
  /** 0-based place in the Queue. */
  index: number
  count: number
  lib: LibraryItem | undefined
  /** A new order is being saved: no moves until it lands. */
  busy: boolean
  /** While another row is dragged: how far this one steps aside (px) to open the gap where it would land. */
  shift: number
  /** A drag is on: rows that step aside slide (never on the drop, which reorders in place). */
  dragActive: boolean
  /** `focus`: the control to give focus back to once the row has moved. */
  onMove: (from: number, to: number, focus?: HTMLElement) => void
  onOpen: () => void
  onPlan: () => void
  onRemove: () => void
}

/**
 * One Queue row. The row drags (a mouse moves it, a finger holds then moves
 * it); its buttons never start a drag (`data-no-drag`). Alt+↑ / Alt+↓ on any
 * of its controls moves it too.
 */
export function QueueRow({ item: i, index: n, count, lib, busy, shift, dragActive, onMove, onOpen, onPlan, onRemove }: Props) {
  const id = i.listItemId
  const drag = useDraggable({ id, disabled: busy })
  const drop = useDroppable({ id })
  const ref = (el: HTMLLIElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el) }
  const dragging = drag.isDragging
  const y = dragging ? (drag.transform?.y ?? 0) : shift
  const poster = i.posterPath ?? lib?.posterPath ?? null

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    const to = busy ? null : queueKeyMove(e.key, e.altKey, n, count)
    if (to == null) return
    e.preventDefault()
    onMove(n, to, e.target as HTMLElement)
  }

  return (
    <li
      ref={ref}
      {...drag.listeners}
      onKeyDown={onKeyDown}
      data-queue-row={id}
      style={y ? { transform: `translate3d(0, ${y}px, 0)` } : undefined}
      className={cx(
        // touch-pan-y: a swipe still scrolls; only a held finger drags. No callout or text selection on a hold.
        'relative flex touch-pan-y select-none items-center gap-2 rounded-row border bg-surface p-2 [-webkit-touch-callout:none]',
        '[@media(hover:hover)]:cursor-grab',
        // The slide is CSS: Reduce Motion turns it off (index.css).
        dragging ? 'z-10 cursor-grabbing border-accent-500/40 shadow-menu' : cx('border-line', dragActive && 'transition-transform duration-150 ease-out'),
      )}
    >
      <GripVertical aria-hidden className="-mr-1 hidden h-4 w-4 shrink-0 text-fg-faint @[34rem]:block" />
      <span className="w-6 shrink-0 text-center text-meta font-semibold text-fg-muted tabular-nums">{n + 1}</span>
      <button type="button" disabled={!i.tmdb} onClick={onOpen} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" className="press-feedback flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="h-[54px] w-9 shrink-0 overflow-hidden rounded bg-surface-2">
          {poster && <img src={posterUrl(poster, 'w92')} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />}
        </span>
        <span className="min-w-0">
          <Truncate className="text-body font-medium text-fg">{i.title}</Truncate>
          <span className="flex items-center gap-1.5 text-micro text-fg-muted">
            {[i.type === 'show' ? 'TV' : 'Movie', i.year].filter(Boolean).join(' · ')}
            {lib && <><ToneDot tone={BUCKET_TONE[lib.bucket]} /> {BUCKET_LABEL[lib.bucket]}</>}
          </span>
        </span>
      </button>
      {/* Narrow (a phone): up, down and ⋯ — the title keeps its room; wide: every action in the row. */}
      <div data-no-drag="" className="flex shrink-0 cursor-auto items-center">
        {n > 1 && <IconButton label="Move to the top" disabled={busy} onClick={e => onMove(n, 0, e.currentTarget)} className="hidden @[34rem]:inline-flex"><ChevronsUp /></IconButton>}
        <IconButton label="Move up" disabled={n === 0 || busy} onClick={e => onMove(n, n - 1, e.currentTarget)}><ArrowUp /></IconButton>
        <IconButton label="Move down" disabled={n === count - 1 || busy} onClick={e => onMove(n, n + 1, e.currentTarget)}><ArrowDown /></IconButton>
        <IconButton label={`Plan ${i.title}`} onClick={onPlan} className="hidden @[34rem]:inline-flex"><CalendarPlus /></IconButton>
        <IconButton label={`Remove ${i.title} from the Queue`} onClick={onRemove} className="hidden @[34rem]:inline-flex"><X /></IconButton>
        <Menu as="div" className="@[34rem]:hidden">
          <MenuButton className="icon-btn" aria-label={`More for ${i.title}`} title={`More for ${i.title}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
            {n > 0 && (
              <MenuItem disabled={busy}>
                <button type="button" title="Top — move it to the top of the Queue" className="menu-item" onClick={() => onMove(n, 0)}><ChevronsUp aria-hidden className="h-4 w-4" /> Top</button>
              </MenuItem>
            )}
            <MenuItem>
              <button type="button" title={`Plan — put “${i.title}” in your calendar`} className="menu-item" onClick={onPlan}><CalendarPlus aria-hidden className="h-4 w-4" /> Plan</button>
            </MenuItem>
            <MenuItem>
              <button type="button" title={`Remove — take “${i.title}” out of the Queue`} className="menu-item" onClick={onRemove}><X aria-hidden className="h-4 w-4" /> Remove</button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>
    </li>
  )
}
