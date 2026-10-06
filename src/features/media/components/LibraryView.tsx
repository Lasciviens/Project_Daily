import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { EmptyState, ToneDot } from '../../../shared/ui'
import { POSTER_GRID, PosterTile } from './PosterTile'
import { BUCKET_LABEL, BUCKET_ORDER, BUCKET_TONE, bucketCounts, defaultSortFor, filterLibrary, type LibraryBucket, type LibraryItem, type LibrarySort } from '../libraryModel'
import type { MediaType, OpenMediaDetail } from '../types'

interface Props {
  items: LibraryItem[]
  mediaType: MediaType
  /** The Movies | TV switch, shown with the library's own controls. */
  typeSwitch?: ReactNode
  bucket: LibraryBucket | 'all'
  onBucketChange: (b: LibraryBucket | 'all') => void
  onOpenDetail: OpenMediaDetail
}

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Release year' },
  { value: 'release', label: 'Release date' },
  { value: 'rating', label: 'Your rating' },
  { value: 'rt', label: 'Rotten Tomatoes' },
]

/** The whole library: filter by status, search by title, sort, and a poster grid that adds columns as it widens. */
export function LibraryView({ items, mediaType, typeSwitch, bucket, onBucketChange, onOpenDetail }: Props) {
  const [query, setQuery] = useState('')
  // A picked sort holds until the status changes; each status opens in its own default order.
  const [picked, setPicked] = useState<{ bucket: LibraryBucket | 'all'; sort: LibrarySort } | null>(null)
  const sort = picked?.bucket === bucket ? picked.sort : defaultSortFor(bucket)
  const setSort = (s: LibrarySort) => setPicked({ bucket, sort: s })
  const counts = bucketCounts(items)
  const shown = useMemo(() => filterLibrary(items, bucket, query, sort), [items, bucket, query, sort])
  // The popup steps through exactly what is on screen, in this order.
  const sequence = useMemo(() => shown.map(i => ({ tmdbId: i.tmdbId, mediaType })), [shown, mediaType])

  return (
    <section className="card @container flex flex-col gap-4 p-4 sm:p-5">
      {/* Type and sort on one row, the title search, then the status filter right above the covers. */}
      <div className="flex flex-wrap items-center gap-2">
        {typeSwitch}
        <label className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 text-meta text-fg-muted @[28rem]:flex-none">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select aria-label="Sort" className="input w-full min-w-0 max-w-[12rem] @[28rem]:w-auto @[28rem]:max-w-none" value={sort} onChange={e => setSort(e.target.value as LibrarySort)}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="relative w-full max-w-md sm:order-first sm:w-auto sm:flex-1">
          <span className="sr-only">Search the library</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input className="input pl-9" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your library…" />
        </label>
      </div>

      {/* One scrolling row on a phone instead of a ragged second line. */}
      <div className="scroll-x -mx-1 flex gap-1.5 px-1 [&>*]:shrink-0 @[40rem]:flex-wrap" role="group" aria-label="Status">
        <FilterChip active={bucket === 'all'} onClick={() => onBucketChange('all')} label="All" count={items.length} />
        {BUCKET_ORDER.filter(b => counts[b] > 0).map(b => (
          <FilterChip key={b} active={bucket === b} onClick={() => onBucketChange(b)} label={BUCKET_LABEL[b]} count={counts[b]} bucket={b} />
        ))}
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
                language={i.language}
                releaseDate={i.releaseDate}
                onOpen={() => onOpenDetail(i.tmdbId, mediaType, sequence)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FilterChip({ active, onClick, label, count, bucket }: { active: boolean; onClick: () => void; label: string; count: number; bucket?: LibraryBucket }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`chip min-h-[44px] press-feedback sm:min-h-[36px] ${active ? 'bg-accent-500 text-on-accent' : ''}`}>
      {bucket && <ToneDot tone={BUCKET_TONE[bucket]} />}
      {label} <span className={`tabular-nums ${active ? '' : 'text-fg-muted'}`}>{count}</span>
    </button>
  )
}
