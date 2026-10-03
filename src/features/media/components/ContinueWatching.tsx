import { X } from 'lucide-react'
import { posterUrl } from '../../../integrations/tmdb/client'
import { SectionLabel, Truncate } from '../../../shared/ui'
import { useLibraryIndex } from '../hooks/useLibraryIndex'
import { useTmdbBasic } from '../hooks/useTMDB'
import { libraryKey } from '../listModel'
import { useRemoveTraktPlayback, useTraktPlayback } from '../trakt/useTraktExtras'
import type { TraktPlaybackItem } from '../trakt/traktApi'
import type { OpenMediaDetail } from '../types'

function Tile({ item, posters, inLibrary, onOpen, onRemove }: {
  item: TraktPlaybackItem
  posters: Map<string, string | null>
  inLibrary: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const type = item.type === 'movie' ? 'movie' : 'tv'
  const known = item.tmdb ? posters.get(`${type}:${item.tmdb}`) : undefined
  const { data } = useTmdbBasic(type, item.tmdb, known === undefined)
  const poster = known ?? data?.poster_path ?? null
  const sub = item.type === 'episode' && item.season != null
    ? `S${item.season}E${item.episode}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`
    : 'Movie'
  return (
    <div className="relative w-24 shrink-0 self-start">
    <button type="button" onClick={onOpen} className="group flex w-full flex-col text-left">
      <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-surface-2">
        <img src={posterUrl(poster, 'w185')} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover group-hover:brightness-90" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-scrim/50">
          <span className="block h-full bg-accent-500" style={{ width: `${Math.min(100, item.progress)}%` }} />
        </span>
      </span>
      <Truncate className="mt-1 text-meta font-medium text-fg">{item.title}</Truncate>
      <Truncate className="text-micro text-fg-muted">{`${sub} · ${Math.round(item.progress)}%`}</Truncate>
      {!inLibrary && <span className="text-micro font-medium text-warn">Not in library</span>}
    </button>
    {/* 24px visual on a dense strip, 44px hit area via the ::after inset. */}
    <button type="button" onClick={onRemove} aria-label={`Remove ${item.title} from Continue watching`}
      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-scrim/70 text-on-accent after:absolute after:-inset-2.5 after:content-[''] hover:bg-scrim">
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
    </div>
  )
}

/**
 * Trakt's paused playbacks (a film or episode stopped part-way in Plex,
 * Infuse, a TV app…), newest first. Titles you finished or dropped here are
 * left out; ✕ removes a playback on Trakt. Hidden when there is nothing to resume.
 */
export function ContinueWatching({ posters, onOpenDetail }: { posters: Map<string, string | null>; onOpenDetail: OpenMediaDetail }) {
  const { data } = useTraktPlayback()
  const index = useLibraryIndex()
  const remove = useRemoveTraktPlayback()
  const entry = (i: TraktPlaybackItem) => index.get(libraryKey(i.type === 'movie' ? 'movie' : 'tv', i.tmdb!))
  const items = (data ?? [])
    .filter(i => i.tmdb)
    .filter(i => { const b = entry(i)?.bucket; return b !== 'completed' && b !== 'dropped' })
    .slice(0, 12)
  if (items.length === 0) return null
  const sequence = items.map(i => ({ tmdbId: i.tmdb!, mediaType: i.type === 'movie' ? 'movie' as const : 'tv' as const }))
  return (
    <div>
      <SectionLabel className="mb-1.5">Continue watching</SectionLabel>
      <div className="scroll-x flex gap-2.5 pb-1">
        {items.map(i => (
          <Tile key={i.id} item={i} posters={posters} inLibrary={!!entry(i)}
            onOpen={() => onOpenDetail(i.tmdb!, i.type === 'movie' ? 'movie' : 'tv', sequence)}
            onRemove={() => remove.mutate(i.id)} />
        ))}
      </div>
    </div>
  )
}
