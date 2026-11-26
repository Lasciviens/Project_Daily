import type { ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDown, ArrowUp, ChevronsUp, MoreHorizontal } from 'lucide-react'
import { IconButton } from '../Button'
import { cx } from '../cx'

interface Props {
  /** The row's name, for the buttons' descriptions. */
  name: string
  /** The row's place (0-based) and how many rows the list has. */
  index: number
  count: number
  /** One move (the row's `useDragReorderRow().move`). */
  onMove: (to: number, focus?: HTMLElement | null) => void
  /** The row's own menu lines, after Top / Up / Down. */
  children?: ReactNode
  /** From this width of the row's container (`@container`) up, ↑ ↓ sit in the row and ⋯ holds only `children`. */
  wide?: keyof typeof WIDE
  /** Offer "Top" (long lists). */
  top?: boolean
  /** The list can't be edited now. */
  disabled?: boolean
}

// Literal class names: Tailwind finds only whole classes in the source.
const WIDE = {
  '26rem': { inRow: 'hidden @[26rem]:inline-flex', narrowOnly: '@[26rem]:hidden' },
  '30rem': { inRow: 'hidden @[30rem]:inline-flex', narrowOnly: '@[30rem]:hidden' },
} as const

/**
 * The keyboard and menu way to move a row of a `DragReorderList`: ↑ ↓ in
 * the row on a wide row, and Up / Down in ⋯ on a narrow one, where the
 * arrows would squeeze the title (owner, 25.11.2026: the drag does the
 * moving there). The menu opens in a portal, outside the row's container, so
 * a ⋯ with lines of its own lists Up / Down at every width. Put it inside
 * the row's `data-no-drag` part.
 */
export function ReorderControls({ name, index: n, count, onMove, children, wide = '30rem', top = false, disabled = false }: Props) {
  const { inRow, narrowOnly } = WIDE[wide]
  return (
    <>
      <IconButton label={`Move ${name} up`} disabled={disabled || n === 0} onClick={e => onMove(n - 1, e.currentTarget)} className={inRow}><ArrowUp /></IconButton>
      <IconButton label={`Move ${name} down`} disabled={disabled || n === count - 1} onClick={e => onMove(n + 1, e.currentTarget)} className={inRow}><ArrowDown /></IconButton>
      {(children || (count > 1 && !disabled)) && (
        <Menu as="div" className={cx(!children && narrowOnly)}>
          <MenuButton className="icon-btn" aria-label={`More for ${name}`} title={`More for ${name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
            {!disabled && top && n > 1 && (
              <MenuItem>
                <button type="button" title="Top — move it to the top" className="menu-item" onClick={() => onMove(0)}><ChevronsUp aria-hidden className="h-4 w-4" /> Top</button>
              </MenuItem>
            )}
            {!disabled && n > 0 && (
              <MenuItem>
                <button type="button" title="Up — move it up one place" className="menu-item" onClick={() => onMove(n - 1)}><ArrowUp aria-hidden className="h-4 w-4" /> Up</button>
              </MenuItem>
            )}
            {!disabled && n < count - 1 && (
              <MenuItem>
                <button type="button" title="Down — move it down one place" className="menu-item" onClick={() => onMove(n + 1)}><ArrowDown aria-hidden className="h-4 w-4" /> Down</button>
              </MenuItem>
            )}
            {children}
          </MenuItems>
        </Menu>
      )}
    </>
  )
}
