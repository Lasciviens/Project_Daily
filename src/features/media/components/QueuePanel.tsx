import { useEntityModal } from '../../../shared/modals'
import { Skeleton } from '../../../shared/ui'
import { DragReorderList } from '../../../shared/ui/dragReorder/DragReorderList'
import { moveItem } from '../../../shared/ui/dragReorder/dragReorderModel'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { libraryKey } from '../listModel'
import { useQueue, useReorderQueue } from '../queue/useQueue'
import { useRemoveFromTraktList } from '../trakt/useTraktExtras'
import type { TraktListItem } from '../trakt/traktApi'
import type { MediaType, OpenMediaDetail } from '../types'
import { QueueRow } from './QueueRow'

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

  if (loading) return <Skeleton className="h-40 w-full" />
  if (!list || items.length === 0) {
    return <p className="text-body text-fg-muted">The Queue is empty — use “+ Queue” on a title page. New titles go to the end; move them here.</p>
  }
  const typeOf = (i: TraktListItem): MediaType => (i.type === 'show' ? 'tv' : 'movie')
  const libOf = (i: TraktListItem) => (i.tmdb ? index.get(libraryKey(typeOf(i), i.tmdb)) : undefined)
  // Every move (a drop, ↑ ↓, Top, Alt+↑/↓) is one save of the whole order (useReorderQueue: shown at once, newest sent).
  const move = (from: number, to: number) => reorder.save(moveItem(items, from, to))
  const remove = (items: TraktListItem[], title: string, done: string) => {
    const refs = items.filter(i => i.tmdb).map(i => ({ type: i.type, tmdb: i.tmdb! }))
    void removeItems(list.id, refs, { title, done })
  }
  const finished = items.filter(i => libOf(i)?.bucket === 'completed')
  const removeOne = (i: TraktListItem) => remove([i], `Take “${i.title}” out of the Queue?`, `Took “${i.title}” out of the Queue`)
  const plan = (i: TraktListItem) => modal.open({
    kind: 'time-block',
    defaults: { title: `Watch: ${i.title}`, duration: i.type === 'show' ? 60 : 120, category: 'media', color: 'purple', alsoCreateTask: true },
  })
  const open = (i: TraktListItem) => {
    if (i.tmdb) onOpen(i.tmdb, typeOf(i), items.filter(x => x.tmdb).map(x => ({ tmdbId: x.tmdb!, mediaType: typeOf(x) })))
  }

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-muted">
        {/* The count is in the list's header line already. */}
        <span title="Drag a row (on touch: hold it, then drag), or use ↑ ↓ (⋯ on a narrow screen) — or Alt+↑ / Alt+↓ on a row. The order is saved on Trakt.">
          <span className="[@media(pointer:coarse)]:hidden">Drag to reorder</span>
          <span className="hidden [@media(pointer:coarse)]:inline">Hold a row, then drag</span> · saved on Trakt
        </span>
        {finished.length > 0 && (
          <button type="button" className="min-h-[44px] font-semibold text-accent-600" onClick={() => remove(finished, `Take ${finished.length} watched out of the Queue?`, `Took ${finished.length} watched out of the Queue`)}>
            Remove {finished.length} watched
          </button>
        )}
      </div>
      <DragReorderList
        ids={items.map(i => i.listItemId)}
        onMove={move}
        label="Queue"
        nameOf={id => items.find(i => i.listItemId === id)?.title ?? 'The title'}
        className="flex max-w-3xl flex-col gap-2"
      >
        {items.map(i => (
          <QueueRow key={i.listItemId} item={i} lib={libOf(i)} onOpen={() => open(i)} onPlan={() => plan(i)} onRemove={() => removeOne(i)} />
        ))}
      </DragReorderList>
      <p className="text-micro text-fg-faint">Tip: the same list is “Queue” on Trakt — reordering there shows up here too.</p>
      {reorder.saving && <span className="sr-only" aria-live="polite">Saving the order…</span>}
    </div>
  )
}
