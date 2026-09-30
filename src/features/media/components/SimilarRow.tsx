import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { libraryKey } from '../listModel'
import { PosterTile } from './PosterTile'
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
  const index = useLibraryIndex()

  if (!isLoading && !data?.length) return null

  return (
    <div>
      <SectionLabel className="mb-2">More like this</SectionLabel>
      <div className="scroll-x flex gap-2.5 pb-1">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-md" className="aspect-[2/3] w-24 shrink-0" />)
          : data!.map((item: TMDBSearchMovie | TMDBSearchTV) => {
              const lib = index.get(libraryKey(mediaType, item.id))
              return (
                <div key={item.id} className="w-24 shrink-0 self-start">
                  <PosterTile
                    compact
                    posterPath={item.poster_path}
                    title={'title' in item ? item.title : item.name}
                    meta={item.vote_average > 0 ? `TMDB ${item.vote_average.toFixed(1)}` : undefined}
                    bucket={lib?.bucket}
                    cinema={lib?.cinema}
                    favorite={lib?.favorite}
                    onOpen={() => onOpenDetail(item.id, mediaType)}
                  />
                </div>
              )
            })}
      </div>
    </div>
  )
}
