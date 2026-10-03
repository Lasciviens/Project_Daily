import { useEffect, useMemo, useState } from 'react'
import { SearchX, SlidersHorizontal } from 'lucide-react'
import { Button, EmptyState } from '../../../shared/ui'
import { useGenres } from '../hooks/useDiscover'
import { NO_SEARCH_FILTERS, applySearchFilters, searchFilterCount, type SearchFilters, type SearchSort } from '../searchFilters'
import { useSearchTitles } from '../hooks/useTMDB'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { libraryKey } from '../listModel'
import { POSTER_GRID, PosterTile } from './PosterTile'
import { SkeletonGrid } from './DiscoverFilters'
import type { MediaType, OpenMediaDetail, TMDBSearchMovie, TMDBSearchTV } from '../types'

interface Props {
  /** The settled (debounced) query. */
  query: string
  /** Typing has not settled yet (or the box is empty): show placeholders. */
  pending?: boolean
  mediaType: MediaType
  onOpenDetail: OpenMediaDetail
  onClear: () => void
}

const SELECT = 'input w-auto min-h-[36px] shrink-0 py-0 pl-2.5 pr-7 text-meta [@media(pointer:coarse)]:min-h-[44px]'
const YEARS = [2025, 2020, 2010, 2000, 1990, 1980]
const num = (v: string) => (v === '' ? null : Number(v))

const isMovie = (r: TMDBSearchMovie | TMDBSearchTV): r is TMDBSearchMovie => 'title' in r

/**
 * Search results in place of the overview: a poster grid with your library
 * status on each cover. A title opens as a popup over this screen, so closing
 * it (or Back) lands right here at the same scroll position. Both types are
 * searched, so the other type's count is one tap away.
 */
export function MediaSearchResults({ query, pending, mediaType, onOpenDetail, onClear }: Props) {
  const q = query.trim()
  const movies = useSearchTitles('movie', q)
  const tv = useSearchTitles('tv', q)
  const index = useLibraryIndex()
  const { data: genres = [] } = useGenres(mediaType)
  const [filters, setFilters] = useState<SearchFilters>(NO_SEARCH_FILTERS)
  const set = (p: Partial<SearchFilters>) => setFilters(f => ({ ...f, ...p }))
  const active = mediaType === 'movie' ? movies : tv
  const other = mediaType === 'movie' ? tv : movies
  const hits = useMemo(() => {
    const seen = new Set<number>()
    return (active.data?.pages ?? []).flatMap(p => p.results)
      .filter(h => (seen.has(h.id) ? false : (seen.add(h.id), true)))
      .map(h => ({ ...h, date: (isMovie(h) ? h.release_date : h.first_air_date) || null, rating: h.vote_average, votes: h.vote_count ?? 0, genres: h.genre_ids ?? [] }))
  }, [active.data])
  const unique = applySearchFilters(hits, filters, id => index.has(libraryKey(mediaType, id)))
  const filterCount = searchFilterCount(filters)
  const narrowed = filterCount > 0
  const [showFilters, setShowFilters] = useState(false)
  const sequence = unique.map(h => ({ tmdbId: h.id, mediaType }))
  const total = (r: typeof movies) => r.data?.pages[0]?.total
  const left = (total(active) ?? 0) - hits.length

  // Filters run over loaded pages: when they leave too few, load a few more by themselves.
  const loaded = active.data?.pages.length ?? 0
  useEffect(() => {
    if (narrowed && unique.length < 12 && active.hasNextPage && !active.isFetchingNextPage && loaded < 6) void active.fetchNextPage()
  }, [narrowed, unique.length, active, loaded])

  if (pending || !q) {
    return <section aria-label="Search results" className="card p-3 sm:p-5"><SkeletonGrid count={9} /></section>
  }

  return (
    <section aria-label="Search results" className="card @container p-3 sm:p-5">
      <h2 className="sr-only">Results for {q}</h2>
      {/* The type (with each type's count) is the switch beside the search box.
          Sort is always on screen; the filters open under it, like Discover's. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <select aria-label="Sort" className={SELECT} value={filters.sort} onChange={e => set({ sort: e.target.value as SearchSort })}>
          <option value="relevance">Best match</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="rating">Best rated</option>
        </select>
        <Button size="sm" variant={narrowed ? 'primary' : 'secondary'} icon={<SlidersHorizontal />} aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}>
          Filters{narrowed ? ` · ${filterCount}` : ''}
        </Button>
        {narrowed && (
          <button type="button" onClick={() => setFilters(f => ({ ...NO_SEARCH_FILTERS, sort: f.sort }))}
            className="min-h-[44px] shrink-0 px-2 text-meta font-semibold text-accent-600 sm:min-h-[36px]">Clear</button>
        )}
      </div>
      {showFilters && (
        <div role="group" aria-label="Filters" className="mb-3 flex flex-wrap items-center gap-1.5">
          <select aria-label="Genre" className={`${SELECT} max-w-[11rem]`} value={filters.genre ?? ''} onChange={e => set({ genre: num(e.target.value) })}>
            <option value="">Genre</option>
            {genres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select aria-label="Released from" className={SELECT} value={filters.fromYear ?? ''} onChange={e => set({ fromYear: num(e.target.value) })}>
            <option value="">Year</option>
            {YEARS.map(y => <option key={y} value={y}>{y}+</option>)}
          </select>
          <select aria-label="TMDB score" className={SELECT} value={filters.minRating ?? ''} onChange={e => set({ minRating: num(e.target.value) })}>
            <option value="">Score</option>
            {[6, 7, 8].map(r => <option key={r} value={r}>{r}+</option>)}
          </select>
          <button type="button" aria-pressed={filters.notInLibrary} onClick={() => set({ notInLibrary: !filters.notInLibrary })}
            className="pill-tab min-h-[36px] shrink-0 border border-line aria-pressed:border-transparent">Not in library</button>
        </div>
      )}

      {active.isLoading ? (
        <SkeletonGrid count={9} />
      ) : active.isError ? (
        <p className="text-body text-fg-muted">
          Couldn't search. {(active.error as Error)?.message}{' '}
          <button type="button" className="font-semibold text-accent-600" onClick={() => { void active.refetch() }}>Try again</button>
        </p>
      ) : unique.length === 0 ? (
        <EmptyState icon={<SearchX />} title={`No ${mediaType === 'movie' ? 'movies' : 'TV series'} found`}
          description={narrowed ? 'Nothing matches these filters.' : (total(other) ?? 0) > 0 ? `${total(other)!.toLocaleString('en-GB')} found under ${mediaType === 'movie' ? 'TV' : 'Movies'} — tap it above.` : 'Try another spelling or fewer words.'}
          action={<Button onClick={onClear}>Clear search</Button>} />
      ) : (
        <>
          <ul className={`${POSTER_GRID} transition-opacity ${active.isPlaceholderData ? 'opacity-60' : ''}`}>
            {unique.map(h => {
              const lib = index.get(libraryKey(mediaType, h.id))
              return (
                <li key={h.id} className="min-w-0">
                  <PosterTile
                    posterPath={h.poster_path}
                    title={isMovie(h) ? h.title : h.name}
                    meta={[h.date?.slice(0, 4), h.vote_average > 0 ? `TMDB ${h.vote_average.toFixed(1)}` : null].filter(Boolean).join(' · ') || undefined}
                    language={h.original_language}
                    bucket={lib?.bucket}
                    rt={lib?.rt}
                    favorite={lib?.favorite}
                    cinema={lib?.cinema}
                    onOpen={() => onOpenDetail(h.id, mediaType, sequence)}
                  />
                </li>
              )
            })}
          </ul>
          {active.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button onClick={() => { void active.fetchNextPage() }} loading={active.isFetchingNextPage}>
                {left > 0 ? `Show more (${left.toLocaleString('en-GB')} left)` : 'Show more'}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
