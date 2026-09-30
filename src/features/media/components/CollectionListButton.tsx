import { ListPlus } from 'lucide-react'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { libraryKey } from '../listModel'
import { PosterTile } from './PosterTile'
import { Button, SectionLabel } from '../../../shared/ui'
import { useCollection } from '../hooks/useTMDB'
import { useTraktStatus } from '../trakt/useTrakt'
import { useCreateTraktList } from '../trakt/useTraktExtras'
import type { MediaType, TMDBMovieFull } from '../types'

/**
 * A film's franchise (TMDB collection) in release order, with one tap to save
 * it as a Trakt list — the start of "lists" for Harry Potter, Dune and co.
 */
export function CollectionListButton({ movie, onOpenDetail }: { movie: TMDBMovieFull; onOpenDetail?: (id: number, type: MediaType) => void }) {
  const col = movie.belongs_to_collection ?? null
  const { data } = useCollection(col?.id ?? null)
  const { data: trakt } = useTraktStatus()
  const create = useCreateTraktList()
  const index = useLibraryIndex()
  if (!col || !data) return null
  const parts = [...data.parts].sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
  if (parts.length < 2) return null

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>{data.name} · {parts.length} films</SectionLabel>
        {trakt?.connected && (
          <Button
            size="sm" variant="ghost" icon={<ListPlus />} loading={create.isPending}
            onClick={() => create.mutate({ name: data.name, items: parts.map(p => ({ type: 'movie', tmdb: p.id })) })}
          >
            Save as list
          </Button>
        )}
      </div>
      <div className="scroll-x flex gap-2.5 pb-1 pt-1">
        {parts.map((p, i) => {
          const lib = index.get(libraryKey('movie', p.id))
          return (
            <div key={p.id} className={`w-24 shrink-0 self-start rounded-md ${p.id === movie.id ? 'ring-2 ring-accent-500 ring-offset-2 ring-offset-surface' : ''}`} aria-current={p.id === movie.id ? 'true' : undefined}>
              <PosterTile
                compact
                posterPath={p.poster_path}
                title={p.title}
                meta={`${i + 1} · ${p.release_date?.slice(0, 4) ?? 'TBA'}`}
                bucket={lib?.bucket}
                cinema={lib?.cinema}
                favorite={lib?.favorite}
                onOpen={() => onOpenDetail?.(p.id, 'movie')}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
