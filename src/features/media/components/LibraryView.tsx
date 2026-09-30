import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { EmptyState } from '../../../shared/ui'
import { POSTER_GRID, PosterTile } from './PosterTile'
import { BUCKET_LABEL, BUCKET_ORDER, bucketCounts, filterLibrary, type LibraryBucket, type LibraryItem, type LibrarySort } from '../libraryModel'
import type { MediaType } from '../types'

interface Props {
  items: LibraryItem[]
  mediaType: MediaType
  bucket: LibraryBucket | 'all'
  onBucketChange: (b: LibraryBucket | 'all') => void
  onOpenDetail: (id: number, type: MediaType) => void
}

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Release year' },
  { value: 'rating', label: 'Your rating' },
  { value: 'rt', label: 'Rotten Tomatoes' },
]

/** The whole library: filter by status, search by title, sort, and a poster grid that adds columns as it widens. */
export function LibraryView({ items, mediaType, bucket, onBucketChange, onOpenDetail }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('added')
  const counts = bucketCounts(items)
  const shown = useMemo(() => filterLibrary(items, bucket, query, sort), [items, bucket, query, sort])

  return (
    <section className="card @container flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
        <FilterChip active={bucket === 'all'} onClick={() => onBucketChange('all')} label="All" count={items.length} />
        {BUCKET_ORDER.filter(b => counts[b] > 0).map(b => (
          <FilterChip key={b} active={bucket === b} onClick={() => onBucketChange(b)} label={BUCKET_LABEL[b]} count={counts[b]} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-md">
          <span className="sr-only">Search the library</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input className="input pl-9" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your library…" />
        </label>
        <label className="flex items-center gap-2 text-meta text-fg-muted">
          Sort
          <select className="input w-auto" value={sort} onChange={e => setSort(e.target.value as LibrarySort)}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={query ? 'Nothing matches that search' : 'Nothing here yet'} />
      ) : (
        <ul className={POSTER_GRID}>
          {shown.map(i => (
            <li key={i.tmdbId} className="min-w-0">
              <PosterTile
                posterPath={i.posterPath}
                title={i.title}
                meta={i.year ?? undefined}
                bucket={i.bucket}
                rt={i.rt}
                favorite={i.favorite}
                cinema={i.cinema}
                onOpen={() => onOpenDetail(i.tmdbId, mediaType)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`chip min-h-[44px] press-feedback sm:min-h-[36px] ${active ? 'bg-accent-500 text-on-accent' : ''}`}>
      {label} <span className={`tabular-nums ${active ? '' : 'text-fg-muted'}`}>{count}</span>
    </button>
  )
}
