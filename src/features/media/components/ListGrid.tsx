import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState, Skeleton } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useTmdbBasic } from '../hooks/useTMDB'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { LIST_FILTERS, LIST_FILTER_LABEL, filterList, listCounts, withLibrary, type ListFilter, type ListRow, type ListSort, type ListTitle } from '../listModel'
import type { MediaType } from '../types'
import { POSTER_GRID, PosterTile } from './PosterTile'

const SORT_LABEL: Record<ListSort, string> = { order: 'List order', release: 'Release date', title: 'Title', rt: 'Rotten Tomatoes (library titles)' }

function Tile({ row, onOpen, corner }: { row: ListRow; onOpen: () => void; corner?: ReactNode }) {
  // Posters come from the library when the title is known; the rest from TMDB, once each.
  const poster = row.posterPath ?? row.item?.posterPath ?? null
  const { data } = useTmdbBasic(row.type, row.tmdbId, !poster)
  const upcoming = row.release ? row.release > todayStr() : false
  return (
    <PosterTile
      posterPath={poster ?? data?.poster_path ?? null}
      title={row.title}
      meta={[row.type === 'tv' ? 'TV' : null, row.year].filter(Boolean).join(' · ') || undefined}
      bucket={row.item?.bucket}
      rt={row.item?.rt}
      favorite={row.item?.favorite}
      cinema={row.item?.cinema}
      dimmed={upcoming && !row.item}
      onOpen={onOpen}
      corner={corner}
    />
  )
}

interface Props {
  titles: ListTitle[] | undefined
  loading?: boolean
  sorts: ListSort[]
  onOpen: (tmdbId: number, type: MediaType) => void
  /** A per-title corner action (remove from a Trakt list). */
  corner?: (row: ListRow) => ReactNode
  empty?: ReactNode
}

/** A list's titles: watched / not watched / library filters with counts, a sort, and big covers with their status ribbons. */
export function ListGrid({ titles, loading, sorts, onOpen, corner, empty }: Props) {
  const index = useLibraryIndex()
  const [filter, setFilter] = useState<ListFilter>('all')
  const [sort, setSort] = useState<ListSort>(sorts[0])
  const today = todayStr()
  const rows = useMemo(() => withLibrary(titles ?? [], index), [titles, index])
  const counts = useMemo(() => listCounts(rows, today), [rows, today])
  const shown = useMemo(() => filterList(rows, filter, sort, today), [rows, filter, sort, today])

  if (loading) {
    return (
      <div className={POSTER_GRID}>
        {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} rounded="rounded-md" className="aspect-[2/3] w-full" />)}
      </div>
    )
  }
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing in this list yet" bordered />}</>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {LIST_FILTERS.filter(f => f === 'all' || counts[f] > 0).map(f => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`chip min-h-[44px] press-feedback sm:min-h-[36px] ${filter === f ? 'bg-accent-500 text-on-accent' : ''}`}>
              {LIST_FILTER_LABEL[f]} <span className={`tabular-nums ${filter === f ? '' : 'text-fg-muted'}`}>{counts[f]}</span>
            </button>
          ))}
        </div>
        {sorts.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-meta text-fg-muted">
            Sort
            <select className="input w-auto" value={sort} onChange={e => setSort(e.target.value as ListSort)}>
              {sorts.map(s => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
            </select>
          </label>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-body text-fg-muted">Nothing matches this filter.</p>
      ) : (
        <ul className={POSTER_GRID}>
          {shown.map(r => (
            <li key={`${r.type}:${r.tmdbId}`} className="min-w-0">
              <Tile row={r} onOpen={() => onOpen(r.tmdbId, r.type)} corner={corner?.(r)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
