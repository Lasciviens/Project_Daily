import { posterUrl } from '../../../integrations/tmdb/client'
import { useSimilarMovies, useSimilarTV } from '../hooks/useTMDB'
import type { TMDBSearchMovie, TMDBSearchTV } from '../types'

interface Props {
  tmdbId:    number
  mediaType: 'movie' | 'tv'
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

export function SimilarRow({ tmdbId, mediaType, onOpenDetail }: Props) {
  const movieQuery = useSimilarMovies(mediaType === 'movie' ? tmdbId : null)
  const tvQuery    = useSimilarTV(mediaType === 'tv' ? tmdbId : null)

  const data    = mediaType === 'movie' ? movieQuery.data : tvQuery.data
  const loading = mediaType === 'movie' ? movieQuery.isLoading : tvQuery.isLoading

  if (loading) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">More like this</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-16 aspect-[2/3] rounded-md bg-cream-200 animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
    )
  }

  if (!data?.length) return null

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-2">More like this</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.map((item: TMDBSearchMovie | TMDBSearchTV) => {
          const title  = 'title' in item ? item.title : item.name
          const rating = item.vote_average
          return (
            <div
              key={item.id}
              onClick={() => onOpenDetail(item.id, mediaType)}
              className="flex-shrink-0 w-16 cursor-pointer group"
            >
              <div className="aspect-[2/3] rounded-md overflow-hidden bg-ink-100 mb-1">
                <img
                  src={posterUrl(item.poster_path, 'w185')}
                  alt={title}
                  className="w-full h-full object-cover group-hover:brightness-90 transition-all duration-150"
                  loading="lazy"
                />
              </div>
              <p className="text-[9px] text-ink-600 leading-tight line-clamp-2">{title}</p>
              {rating > 0 && <p className="text-[9px] text-ink-400">★ {rating.toFixed(1)}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
