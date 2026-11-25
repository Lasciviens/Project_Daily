import { useEffect, useRef, useState } from 'react'
import { DndContext, closestCenter, type Announcements, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from '@dnd-kit/core'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton } from '../../../shared/ui'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { libraryKey } from '../listModel'
import { moveItem, queueDropTarget, queueShift } from '../queue/queueModel'
import { useQueueDragSensors, withinList } from '../queue/queueDragSensors'
import { useQueue, useReorderQueue } from '../queue/useQueue'
import { useRemoveFromTraktList } from '../trakt/useTraktExtras'
import type { TraktListItem } from '../trakt/traktApi'
import type { MediaType, OpenMediaDetail } from '../types'
import { QueueRow } from './QueueRow'

/** The list's gap between rows (gap-2), in px. */
const ROW_GAP = 8

/**
 * The Queue in order: drag titles into place, or move them up and down (the
 * order is saved on Trakt), plan one, take finished ones out. Watched titles
 * say so.
 */
export function QueuePanel({ onOpen }: { onOpen: OpenMediaDetail }) {
  const { list, items, loading } = useQueue()
  const reorder = useReorderQueue(list?.id ?? null)
  const removeItems = useRemoveFromTraktList()
  const index = useLibraryIndex()
  const modal = useEntityModal()
  const sensors = useQueueDragSensors()
  // While dragging: where from, the row under it, and how far the rows in between step aside (the row's height + the gap).
  const [drag, setDrag] = useState<{ from: number; over: number | null; step: number } | null>(null)
  // The new order shows in the same frame as the drop; the cache's optimistic copy (useReorderQueue) takes over a moment later.
  const [preview, setPreview] = useState<{ base: TraktListItem[]; rows: TraktListItem[] } | null>(null)
  const rows = preview && preview.base === items ? preview.rows : items
  // A move re-inserts the row's node, which drops focus: hand it back once the new order shows.
  const refocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = refocus.current
    if (!el || !el.isConnected) return
    refocus.current = null
    if (document.activeElement !== el) el.focus({ preventScroll: true })
  }, [rows])

  if (loading) return <Skeleton className="h-40 w-full" />
  if (!list || rows.length === 0) {
    return <p className="text-body text-fg-muted">The Queue is empty — use “+ Queue” on a title page. New titles go to the end; move them here.</p>
  }
  const typeOf = (i: TraktListItem): MediaType => (i.type === 'show' ? 'tv' : 'movie')
  const libOf = (i: TraktListItem) => (i.tmdb ? index.get(libraryKey(typeOf(i), i.tmdb)) : undefined)
  // One move (a drop, an arrow, Top, a key) is one save; the new order shows at once and rolls back on an error (useReorderQueue).
  const move = (from: number, to: number, focus?: HTMLElement) => {
    if (from === to || reorder.isPending) return
    refocus.current = focus ?? null
    const next = moveItem(rows, from, to)
    setPreview({ base: items, rows: next })
    reorder.mutate(next)
  }
  const remove = (items: TraktListItem[], title: string, done: string) => {
    const refs = items.filter(i => i.tmdb).map(i => ({ type: i.type, tmdb: i.tmdb! }))
    void removeItems(list.id, refs, { title, done })
  }
  const finished = rows.filter(i => libOf(i)?.bucket === 'completed')
  const removeOne = (i: TraktListItem) => remove([i], `Take “${i.title}” out of the Queue?`, `Took “${i.title}” out of the Queue`)
  const plan = (i: TraktListItem) => modal.open({
    kind: 'time-block',
    defaults: { title: `Watch: ${i.title}`, duration: i.type === 'show' ? 60 : 120, category: 'media', color: 'purple', alsoCreateTask: true },
  })
  const open = (i: TraktListItem) => {
    if (i.tmdb) onOpen(i.tmdb, typeOf(i), rows.filter(x => x.tmdb).map(x => ({ tmdbId: x.tmdb!, mediaType: typeOf(x) })))
  }

  // Drag and drop: the row under the dragged one is where it lands (queueDropTarget); the rows in between step aside to show the gap.
  const at = (id: UniqueIdentifier | undefined) => (id == null ? -1 : rows.findIndex(i => i.listItemId === id))
  const target = drag ? queueDropTarget(drag.from, drag.over, rows.length) : null
  const onDragStart = (e: DragStartEvent) => {
    const r = e.active.rect.current.initial
    setDrag({ from: at(e.active.id), over: null, step: (r?.height ?? 72) + ROW_GAP })
  }
  const onDragOver = (e: DragOverEvent) => setDrag(d => (d ? { ...d, over: e.over ? at(e.over.id) : null } : d))
  const onDragEnd = (e: DragEndEvent) => {
    const from = at(e.active.id)
    const to = queueDropTarget(from, e.over ? at(e.over.id) : null, rows.length)
    setDrag(null)
    if (to != null) move(from, to)
  }
  const titleOf = (id: UniqueIdentifier) => rows[at(id)]?.title ?? 'The title'
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up “${titleOf(active.id)}”, number ${at(active.id) + 1}.`,
    onDragOver: ({ active, over }) => (over ? `“${titleOf(active.id)}” goes to number ${at(over.id) + 1}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `“${titleOf(active.id)}” dropped at number ${at(over.id) + 1}.` : `“${titleOf(active.id)}” stays.`),
    onDragCancel: ({ active }) => `“${titleOf(active.id)}” stays at number ${at(active.id) + 1}.`,
  }

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-muted">
        {/* The count is in the list's header line already. */}
        <span title="Drag a row (on touch: hold it, then drag), or use ↑ ↓ — or Alt+↑ / Alt+↓ on a row. The order is saved on Trakt.">
          <span className="[@media(pointer:coarse)]:hidden">Drag to reorder</span>
          <span className="hidden [@media(pointer:coarse)]:inline">Hold a row, then drag</span> · saved on Trakt
        </span>
        {finished.length > 0 && (
          <button type="button" className="min-h-[44px] font-semibold text-accent-600" onClick={() => remove(finished, `Take ${finished.length} watched out of the Queue?`, `Took ${finished.length} watched out of the Queue`)}>
            Remove {finished.length} watched
          </button>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[withinList]}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        {/* gap-2 is ROW_GAP */}
        <ol aria-label="Queue" className="flex max-w-3xl flex-col gap-2">
          {rows.map((i, n) => (
            <QueueRow
              key={i.listItemId}
              item={i}
              index={n}
              count={rows.length}
              lib={libOf(i)}
              busy={reorder.isPending}
              shift={drag ? queueShift(n, drag.from, target) * drag.step : 0}
              dragActive={drag != null}
              onMove={move}
              onOpen={() => open(i)}
              onPlan={() => plan(i)}
              onRemove={() => removeOne(i)}
            />
          ))}
        </ol>
      </DndContext>
      <p className="text-micro text-fg-faint">Tip: the same list is “Queue” on Trakt — reordering there shows up here too.</p>
      {reorder.isPending && <span className="sr-only" aria-live="polite">Saving the order…</span>}
    </div>
  )
}
