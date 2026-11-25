import { createContext, useContext, type CSSProperties, type KeyboardEvent } from 'react'
import { useDraggable, useDroppable, type UniqueIdentifier } from '@dnd-kit/core'
import { cx } from '../cx'
import { keyMove, shownPlace, stepAside } from './dragReorderModel'

/** What `DragReorderList` tells its rows. */
export interface DragReorderState {
  ids: readonly UniqueIdentifier[]
  /** The dragged row's place, null when nothing is dragged. */
  from: number | null
  /** Where it would land now (null: where it was). */
  target: number | null
  /** How far a row steps aside: the dragged row's height + the list's gap (px). */
  step: number
  /** Nothing moves (`DragReorderList disabled`). */
  disabled: boolean
  /** One move; `focus` gets focus back once the row has moved. */
  move: (from: number, to: number, focus?: HTMLElement | null) => void
}

/** A key typed into a field is the field's (Alt+↑ moves the caret on a Mac). */
function isTyping(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export const DragReorderContext = createContext<DragReorderState | null>(null)

/**
 * One row of a `DragReorderList`. Spread `rowProps` on the row element (an
 * `<li>`), add `rowClassName`, and show `place + 1` as its number. A row
 * drags by itself, never from inside `data-no-drag` (its buttons); Alt+↑ /
 * Alt+↓ on any of its controls moves it.
 *
 * `handle`: only part of the row starts a drag — a card whose body holds
 * fields, tables or links of its own (a project's phase or block, a form
 * row). Spread `handleProps` on that part and add `handleClassName`; Alt+↑ /
 * Alt+↓ then work from the handle's controls only.
 */
export function useDragReorderRow(id: UniqueIdentifier, { handle = false }: { handle?: boolean } = {}) {
  const c = useContext(DragReorderContext)
  if (!c) throw new Error('useDragReorderRow belongs inside a DragReorderList')
  const index = c.ids.indexOf(id)
  const drag = useDraggable({ id, disabled: c.disabled })
  const drop = useDroppable({ id })
  const dragging = drag.isDragging
  const dragActive = c.from != null
  const y = dragging ? (drag.transform?.y ?? 0) : stepAside(index, c.from ?? -1, c.target) * c.step
  const style: CSSProperties | undefined = y ? { transform: `translate3d(0, ${y}px, 0)` } : undefined

  // touch-pan-y: a swipe still scrolls; only a held finger drags. No callout or text selection on a hold.
  const grabClassName = 'touch-pan-y select-none [-webkit-touch-callout:none] [@media(hover:hover)]:cursor-grab'

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Not from a popup opened from the row (a menu in a portal), nor a key a control already used, nor typing.
    if (e.defaultPrevented || !e.currentTarget.contains(e.target as Node) || isTyping(e.target)) return
    const to = keyMove(e.key, e.altKey, index, c.ids.length)
    if (to == null) return
    e.preventDefault()
    c.move(index, to, e.target as HTMLElement)
  }

  return {
    index,
    /** The 0-based place to show: while a row is dragged, the place each row gets if it drops now. */
    place: shownPlace(index, c.from, c.target),
    count: c.ids.length,
    dragging,
    dragActive,
    move: (to: number, focus?: HTMLElement | null) => c.move(index, to, focus),
    rowProps: {
      ref: (el: HTMLElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el) },
      ...(handle ? {} : { ...drag.listeners, onKeyDown }),
      style,
      'data-reorder-row': String(id),
    },
    /** With `handle`: the part that starts a drag. */
    handleProps: handle ? { ref: drag.setActivatorNodeRef, ...drag.listeners, onKeyDown } : {},
    handleClassName: handle ? grabClassName : undefined,
    rowClassName: cx(
      'relative',
      !handle && grabClassName,
      // The slide is CSS and runs only during a drag (never on the drop, which reorders in place); Reduce Motion turns it off (index.css).
      dragging ? 'z-10 cursor-grabbing' : dragActive && 'transition-transform duration-150 ease-out',
    ),
  }
}
