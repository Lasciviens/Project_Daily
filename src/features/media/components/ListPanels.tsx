import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from '../../../app/store'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { useSmartListTitles } from '../hooks/useSmartLists'
import { useChangeTraktList, useTraktListItems } from '../trakt/useTraktExtras'
import type { MediaFollow } from '../api/followsApi'
import { watchedProgress, withLibrary, type ListTitle } from '../listModel'
import type { OpenMediaDetail } from '../types'
import { ListGrid } from './ListGrid'

export function ListProgress({ titles }: { titles: ListTitle[] | undefined }) {
  const index = useLibraryIndex()
  const p = useMemo(() => watchedProgress(withLibrary(titles ?? [], index), todayStr()), [titles, index])
  if (!titles?.length || p.released === 0) return null
  const pct = Math.round((p.watched / p.released) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2"><span data-tone="success" className="tone-solid block h-full" style={{ width: `${pct}%` }} /></span>
      <span className="text-meta text-fg-muted tabular-nums">{p.watched} of {p.released} watched</span>
    </div>
  )
}

/** A Trakt list's titles (remove from the corner). */
export function TraktListPanel({ listId, onOpen }: { listId: number; onOpen: OpenMediaDetail }) {
  const items = useTraktListItems(listId)
  const change = useChangeTraktList()
  const titles: ListTitle[] | undefined = useMemo(() => items.data?.filter(i => i.tmdb).map((i, n) => ({
    type: i.type === 'show' ? 'tv' : 'movie', tmdbId: i.tmdb!, title: i.title, posterPath: i.posterPath, release: null, year: i.year, order: i.rank ?? n,
  })), [items.data])
  return (
    <>
      <ListProgress titles={titles} />
      <ListGrid
        titles={titles}
        loading={items.isLoading}
        sorts={['order', 'release', 'title', 'rt']}
        onOpen={onOpen}
        empty={<p className="text-body text-fg-muted">Empty — add titles from their page with “Add to list”.</p>}
        corner={r => (
          <button type="button" aria-label={`Remove ${r.title} from this list`}
            onClick={() => {
              const item = { type: r.type === 'tv' ? 'show' as const : 'movie' as const, tmdb: r.tmdbId }
              change.mutate({ listId, items: [item], remove: true }, {
                onSuccess: () => toast.undo(`Removed ${r.title}`, () => change.mutate({ listId, items: [item] })),
              })
            }}
            className="-m-2 grid h-11 w-11 place-items-center">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-scrim/60 text-white hover:bg-scrim/80"><X aria-hidden className="h-3.5 w-3.5" /></span>
          </button>
        )}
      />
    </>
  )
}

export function SmartListPanel({ follow, onOpen }: { follow: MediaFollow; onOpen: OpenMediaDetail }) {
  // Studio and keyword lists drag in featurettes, specials and documentaries.
  const [hideExtras, setHideExtras] = useState(follow.kind !== 'collection')
  const q = useSmartListTitles(follow.kind, follow.tmdb_id, hideExtras)
  const titles = q.data?.titles
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ListProgress titles={titles} />
        {follow.kind !== 'collection' && (
          <label className="flex min-h-[44px] items-center gap-2 text-meta text-fg-2 sm:min-h-[36px]">
            <input type="checkbox" checked={hideExtras} onChange={e => setHideExtras(e.target.checked)} />
            Hide documentaries and TV movies
          </label>
        )}
      </div>
      {q.data?.capped && <p className="text-meta text-fg-muted tabular-nums">The newest {titles?.length} of {q.data.total} films.</p>}
      {q.error && <p className="text-body text-danger">{(q.error as Error).message}</p>}
      <ListGrid titles={titles} loading={q.isLoading} sorts={follow.kind === 'collection' ? ['order', 'release', 'title'] : ['release', 'title']} onOpen={onOpen} />
    </>
  )
}
