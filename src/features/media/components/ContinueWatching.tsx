import { posterUrl } from '../../../integrations/tmdb/client'
import { SectionLabel, Truncate } from '../../../shared/ui'
import { useTmdbBasic } from '../hooks/useTMDB'
import { useTraktPlayback } from '../trakt/useTraktExtras'
import type { TraktPlaybackItem } from '../trakt/traktApi'
import type { MediaType } from '../types'

function Tile({ item, posters, onOpen }: { item: TraktPlaybackItem; posters: Map<string, string | null>; onOpen: () => void }) {
  const type = item.type === 'movie' ? 'movie' : 'tv'
  const known = item.tmdb ? posters.get(`${type}:${item.tmdb}`) : undefined
  const { data } = useTmdbBasic(type, item.tmdb, known === undefined)
  const poster = known ?? data?.poster_path ?? null
  const sub = item.type === 'episode' && item.season != null
    ? `S${item.season}E${item.episode}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`
    : 'Movie'
  return (
    <button type="button" onClick={onOpen} className="group flex w-24 shrink-0 flex-col self-start text-left">
      <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-surface-2">
        <img src={posterUrl(poster, 'w185')} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover group-hover:brightness-90" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-scrim/50">
          <span className="block h-full bg-accent-500" style={{ width: `${Math.min(100, item.progress)}%` }} />
        </span>
      </span>
      <Truncate className="mt-1 text-meta font-medium text-fg">{item.title}</Truncate>
      <Truncate className="text-micro text-fg-muted">{`${sub} · ${Math.round(item.progress)}%`}</Truncate>
    </button>
  )
}

/**
 * Trakt's paused playbacks (a film or episode stopped part-way in Plex,
 * Infuse, a TV app…), newest first. Hidden when there is nothing to resume.
 */
export function ContinueWatching({ posters, onOpenDetail }: { posters: Map<string, string | null>; onOpenDetail: (id: number, type: MediaType) => void }) {
  const { data } = useTraktPlayback()
  const items = (data ?? []).filter(i => i.tmdb).slice(0, 12)
  if (items.length === 0) return null
  return (
    <div>
      <SectionLabel className="mb-1.5">Continue watching</SectionLabel>
      <div className="scroll-x flex gap-2.5 pb-1">
        {items.map(i => (
          <Tile key={i.id} item={i} posters={posters} onOpen={() => onOpenDetail(i.tmdb!, i.type === 'movie' ? 'movie' : 'tv')} />
        ))}
      </div>
    </div>
  )
}
