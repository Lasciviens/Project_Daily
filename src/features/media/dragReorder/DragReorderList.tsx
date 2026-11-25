import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DndContext, closestCenter, type Announcements, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from '@dnd-kit/core'
import { dropTarget } from './dragReorderModel'
import { DragReorderContext, type DragReorderState } from './dragReorderRow'
import { EDGE_SCROLL, useDragReorderSensors, withinList } from './dragReorderSensors'

interface Props {
  /** The rows' ids, in the order shown. */
  ids: readonly UniqueIdentifier[]
  /** One move = one call; the caller saves it (and shows the new order at once). */
  onMove: (from: number, to: number) => void
  /** The list's accessible name. */
  label: string
  /** A row's name, for what a screen reader hears during a drag. */
  nameOf: (id: UniqueIdentifier) => string
  className?: string
  /** The rows (`useDragReorderRow`). */
  children: ReactNode
}

/**
 * An ordered list whose rows reorder by drag and drop — a mouse, or a finger
 * that holds, then drags — and by Alt+↑ / Alt+↓. While a row is dragged the
 * rows between its place and the row under it step aside and every row shows
 * the number it gets; the drop is one `onMove`.
 */
export function DragReorderList({ ids, onMove, label, nameOf, className, children }: Props) {
  const sensors = useDragReorderSensors()
  const listRef = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<{ from: number; over: number | null; step: number } | null>(null)
  // A move re-inserts the row's node, which drops focus: hand it back once the new order shows.
  const refocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = refocus.current
    refocus.current = null
    if (el?.isConnected && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [ids])

  const at = (id: UniqueIdentifier | undefined) => (id == null ? -1 : ids.indexOf(id))
  const move = (from: number, to: number, focus?: HTMLElement | null) => {
    if (from === to) return
    refocus.current = focus ?? null
    onMove(from, to)
  }
  const onDragStart = (e: DragStartEvent) => {
    // Measured on the page: dnd-kit's own rect of the row isn't there yet at the start.
    const list = listRef.current
    const height = list?.querySelector(`[data-reorder-row="${CSS.escape(String(e.active.id))}"]`)?.getBoundingClientRect().height ?? 0
    const gap = list ? parseFloat(getComputedStyle(list).rowGap) || 0 : 0
    setDrag({ from: at(e.active.id), over: null, step: height + gap })
  }
  const onDragOver = (e: DragOverEvent) => setDrag(d => (d ? { ...d, over: e.over ? at(e.over.id) : null } : d))
  const onDragEnd = (e: DragEndEvent) => {
    const from = at(e.active.id)
    const to = dropTarget(from, e.over ? at(e.over.id) : null, ids.length)
    setDrag(null)
    if (to != null) move(from, to)
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up “${nameOf(active.id)}”, number ${at(active.id) + 1}.`,
    onDragOver: ({ active, over }) => (over ? `“${nameOf(active.id)}” goes to number ${at(over.id) + 1}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `“${nameOf(active.id)}” dropped at number ${at(over.id) + 1}.` : `“${nameOf(active.id)}” stays.`),
    onDragCancel: ({ active }) => `“${nameOf(active.id)}” stays at number ${at(active.id) + 1}.`,
  }
  const state: DragReorderState = {
    ids,
    from: drag?.from ?? null,
    target: drag ? dropTarget(drag.from, drag.over, ids.length) : null,
    step: drag?.step ?? 0,
    move,
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[withinList]}
      autoScroll={EDGE_SCROLL}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <DragReorderContext.Provider value={state}>
        <ol ref={listRef} aria-label={label} className={className}>{children}</ol>
      </DragReorderContext.Provider>
    </DndContext>
  )
}
