import { ListPlus } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
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
      <div className="scroll-x flex gap-2 pb-1">
        {parts.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpenDetail?.(p.id, 'movie')}
            aria-current={p.id === movie.id ? 'true' : undefined}
            className="group flex w-14 shrink-0 flex-col self-start text-left"
          >
            <span className={`mb-1 block aspect-[2/3] overflow-hidden rounded-md bg-surface-2 ${p.id === movie.id ? 'ring-2 ring-accent-500' : ''}`}>
              <img src={posterUrl(p.poster_path, 'w92')} alt="" loading="lazy" className="h-full w-full object-cover group-hover:brightness-90" />
            </span>
            <span className="text-micro tabular-nums text-fg-muted">{i + 1} · {p.release_date?.slice(0, 4) ?? 'TBA'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
