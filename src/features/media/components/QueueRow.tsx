import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDown, ArrowUp, CalendarPlus, ChevronsUp, GripVertical, MoreHorizontal, X } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { IconButton, ToneDot, Truncate, cx } from '../../../shared/ui'
import { useDragReorderRow } from '../../../shared/ui/dragReorder/dragReorderRow'
import { NO_DRAG_ATTR } from '../../../shared/ui/dragReorder/dragReorderSensors'
import { BUCKET_LABEL, BUCKET_TONE, type LibraryItem } from '../libraryModel'
import type { TraktListItem } from '../trakt/traktApi'

interface Props {
  item: TraktListItem
  lib: LibraryItem | undefined
  onOpen: () => void
  onPlan: () => void
  onRemove: () => void
}

/**
 * One Queue row: it drags by itself (poster, number, title), never from its
 * buttons. Narrow (a phone): only ⋯ (Top, Up, Down, Plan, Remove) — the drag
 * does the moving, so the title gets the room (owner, 25.11.2026); from 34rem
 * of the panel's own width every action is in the row.
 */
export function QueueRow({ item: i, lib, onOpen, onPlan, onRemove }: Props) {
  const row = useDragReorderRow(i.listItemId)
  const { index: n, count, dragging } = row
  const poster = i.posterPath ?? lib?.posterPath ?? null
  const noDrag = { [NO_DRAG_ATTR]: '' }

  return (
    <li
      {...row.rowProps}
      className={cx(
        row.rowClassName,
        'flex items-center gap-2 rounded-row border bg-surface p-2',
        dragging ? 'border-accent-500/40 shadow-menu' : 'border-line',
      )}
    >
      <GripVertical aria-hidden className="-mr-1 hidden h-4 w-4 shrink-0 text-fg-faint @[34rem]:block" />
      {/* While a row is dragged every row shows the number it gets if it drops now. */}
      <span className="w-6 shrink-0 text-center text-meta font-semibold text-fg-muted tabular-nums">{row.place + 1}</span>
      <button
        type="button"
        disabled={!i.tmdb}
        onClick={onOpen}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        // No press effect on the row being dragged: it is held, not tapped.
        className={cx('flex min-w-0 flex-1 items-center gap-3 text-left', !dragging && 'press-feedback')}
      >
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
      <div {...noDrag} className="flex shrink-0 cursor-auto items-center">
        {n > 1 && <IconButton label="Move to the top" onClick={e => row.move(0, e.currentTarget)} className="hidden @[34rem]:inline-flex"><ChevronsUp /></IconButton>}
        <IconButton label="Move up" disabled={n === 0} onClick={e => row.move(n - 1, e.currentTarget)} className="hidden @[34rem]:inline-flex"><ArrowUp /></IconButton>
        <IconButton label="Move down" disabled={n === count - 1} onClick={e => row.move(n + 1, e.currentTarget)} className="hidden @[34rem]:inline-flex"><ArrowDown /></IconButton>
        <IconButton label={`Plan ${i.title}`} onClick={onPlan} className="hidden @[34rem]:inline-flex"><CalendarPlus /></IconButton>
        <IconButton label={`Remove ${i.title} from the Queue`} onClick={onRemove} className="hidden @[34rem]:inline-flex"><X /></IconButton>
        <Menu as="div" className="@[34rem]:hidden">
          <MenuButton className="icon-btn" aria-label={`More for ${i.title}`} title={`More for ${i.title}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
            {n > 0 && (
              <MenuItem>
                <button type="button" title="Top — move it to the top of the Queue" className="menu-item" onClick={() => row.move(0)}><ChevronsUp aria-hidden className="h-4 w-4" /> Top</button>
              </MenuItem>
            )}
            {n > 0 && (
              <MenuItem>
                <button type="button" title="Up — move it up one place" className="menu-item" onClick={() => row.move(n - 1)}><ArrowUp aria-hidden className="h-4 w-4" /> Up</button>
              </MenuItem>
            )}
            {n < count - 1 && (
              <MenuItem>
                <button type="button" title="Down — move it down one place" className="menu-item" onClick={() => row.move(n + 1)}><ArrowDown aria-hidden className="h-4 w-4" /> Down</button>
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
