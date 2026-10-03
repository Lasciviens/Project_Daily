import { Search, SearchX } from 'lucide-react'
import { Button, EmptyState } from '../../../shared/ui'
import { useSearchTitles } from '../hooks/useTMDB'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { libraryKey } from '../listModel'
import { POSTER_GRID, PosterTile } from './PosterTile'
import { SkeletonGrid } from './DiscoverFilters'
import type { MediaType, OpenMediaDetail, TMDBSearchMovie, TMDBSearchTV } from '../types'

interface Props {
  /** The settled (debounced) query; under 2 characters asks for more. */
  query: string
  mediaType: MediaType
  onMediaTypeChange: (t: MediaType) => void
  onOpenDetail: OpenMediaDetail
  onClear: () => void
}

const isMovie = (r: TMDBSearchMovie | TMDBSearchTV): r is TMDBSearchMovie => 'title' in r

/**
 * Search results in place of the overview: a poster grid with your library
 * status on each cover. A title opens as a popup over this screen, so closing
 * it (or Back) lands right here at the same scroll position. Both types are
 * searched, so the other type's count is one tap away.
 */
export function MediaSearchResults({ query, mediaType, onMediaTypeChange, onOpenDetail, onClear }: Props) {
  const q = query.trim()
  const movies = useSearchTitles('movie', q)
  const tv = useSearchTitles('tv', q)
  const index = useLibraryIndex()
  const active = mediaType === 'movie' ? movies : tv
  const other = mediaType === 'movie' ? tv : movies
  const hits = (active.data?.pages ?? []).flatMap(p => p.results)
  const seen = new Set<number>()
  const unique = hits.filter(h => (seen.has(h.id) ? false : (seen.add(h.id), true)))
  const sequence = unique.map(h => ({ tmdbId: h.id, mediaType }))
  const total = (r: typeof movies) => r.data?.pages[0]?.total
  const countLabel = (r: typeof movies) => (r.isError ? '!' : total(r) == null ? '…' : total(r)!.toLocaleString('en-GB'))

  if (q.length < 2) {
    return (
      <section aria-label="Search results" className="card p-4 sm:p-5">
        <EmptyState icon={<Search />} title="Keep typing" description="Type at least 2 letters to search movies and TV." />
      </section>
    )
  }

  return (
    <section aria-label="Search results" className="card @container p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto min-w-0 break-words text-lead font-semibold text-fg">Results for “{q}”</h2>
        <div aria-label="Result type" className="flex gap-1.5">
          {(['movie', 'tv'] as const).map(t => (
            <button key={t} type="button" aria-pressed={mediaType === t} onClick={() => onMediaTypeChange(t)}
              className="pill-tab min-h-[44px] shrink-0 tabular-nums sm:min-h-0">
              {t === 'movie' ? 'Movies' : 'TV'} {countLabel(t === 'movie' ? movies : tv)}
            </button>
          ))}
        </div>
      </header>

      {active.isLoading ? (
        <SkeletonGrid count={9} />
      ) : active.isError ? (
        <p className="text-body text-fg-muted">
          Couldn't search. {(active.error as Error)?.message}{' '}
          <button type="button" className="font-semibold text-accent-600" onClick={() => { void active.refetch() }}>Try again</button>
        </p>
      ) : unique.length === 0 ? (
        <EmptyState icon={<SearchX />} title={`No ${mediaType === 'movie' ? 'movies' : 'TV series'} found`}
          description={(total(other) ?? 0) > 0 ? `${total(other)!.toLocaleString('en-GB')} found under ${mediaType === 'movie' ? 'TV' : 'Movies'} — tap it above.` : 'Try another spelling or fewer words.'}
          action={<Button onClick={onClear}>Clear search</Button>} />
      ) : (
        <>
          <ul className={`${POSTER_GRID} transition-opacity ${active.isPlaceholderData ? 'opacity-60' : ''}`}>
            {unique.map(h => {
              const lib = index.get(libraryKey(mediaType, h.id))
              const date = isMovie(h) ? h.release_date : h.first_air_date
              return (
                <li key={h.id} className="min-w-0">
                  <PosterTile
                    posterPath={h.poster_path}
                    title={isMovie(h) ? h.title : h.name}
                    meta={[date?.slice(0, 4), h.vote_average > 0 ? `TMDB ${h.vote_average.toFixed(1)}` : null].filter(Boolean).join(' · ') || undefined}
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
          <p className="mt-3 text-center text-meta tabular-nums text-fg-muted">
            {unique.length.toLocaleString('en-GB')} of {(total(active) ?? unique.length).toLocaleString('en-GB')}
          </p>
          {active.hasNextPage && (
            <div className="mt-2 flex justify-center">
              <Button onClick={() => { void active.fetchNextPage() }} loading={active.isFetchingNextPage}>Show more</Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
