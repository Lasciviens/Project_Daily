import { posterUrl } from '../../../integrations/tmdb/client'
import { useSimilarMovies, useSimilarTV } from '../hooks/useTMDB'
import { SectionLabel, Skeleton } from '../../../shared/ui'
import type { MediaType, TMDBSearchMovie, TMDBSearchTV } from '../types'

interface Props {
  tmdbId:    number
  mediaType: MediaType
  onOpenDetail: (id: number, type: MediaType) => void
}

export function SimilarRow({ tmdbId, mediaType, onOpenDetail }: Props) {
  const movieQuery = useSimilarMovies(mediaType === 'movie' ? tmdbId : null)
  const tvQuery    = useSimilarTV(mediaType === 'tv' ? tmdbId : null)
  const { data, isLoading } = mediaType === 'movie' ? movieQuery : tvQuery

  if (!isLoading && !data?.length) return null

  return (
    <div>
      <SectionLabel className="mb-2">More like this</SectionLabel>
      <div className="scroll-x flex gap-2 pb-1">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-md" className="aspect-[2/3] w-16 shrink-0" />)
          : data!.map((item: TMDBSearchMovie | TMDBSearchTV) => {
              const title = 'title' in item ? item.title : item.name
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenDetail(item.id, mediaType)}
                  className="group w-16 shrink-0 text-left"
                >
                  <span className="mb-1 block aspect-[2/3] overflow-hidden rounded-md bg-surface-2">
                    <img
                      src={posterUrl(item.poster_path, 'w185')}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-[filter] duration-150 group-hover:brightness-90"
                    />
                  </span>
                  <span className="line-clamp-2 text-micro leading-tight text-fg-2">{title}</span>
                  {item.vote_average > 0 && <span className="block text-micro text-fg-muted tabular-nums">★ {item.vote_average.toFixed(1)}</span>}
                </button>
              )
            })}
      </div>
    </div>
  )
}
