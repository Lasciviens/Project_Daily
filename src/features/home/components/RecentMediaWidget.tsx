import { Clapperboard, Film, Tv } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, EmptyState } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useRecentlyWatched, type RecentlyWatchedItem } from '../../media/hooks/useRecentlyWatched'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

function openMedia(modal: ReturnType<typeof useEntityModal>, item: RecentlyWatchedItem) {
  if (item.tmdbId != null) modal.open({ kind: 'media', tmdbId: item.tmdbId, mediaType: item.type })
}

/** Last watched titles; each poster opens that title's popup. */
export function RecentMediaWidget() {
  const ws = useWidgetState('recentMedia', { mobileCollapsed: true })
  const { data = [], isLoading } = useRecentlyWatched({ enabled: !ws.collapsed })
  const modal = useEntityModal()

  return (
    <WidgetShell title="Recently watched" icon={<Clapperboard />} ws={ws} to="/media">
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] w-full" rounded="rounded-md" />)}</div>
      ) : data.length === 0 ? (
        <EmptyState title="Nothing watched yet" description="Mark a film or an episode as watched in Media." className="py-4" />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {data.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => openMedia(modal, item)}
              disabled={item.tmdbId == null}
              className="group flex min-w-0 flex-col text-left press-feedback"
            >
              <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-surface-2">
                <img src={posterUrl(item.poster, 'w154')} alt="" loading="lazy" className="h-full w-full object-cover transition-[filter] duration-150 group-hover:brightness-90" />
                <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-scrim/60 text-white">
                  {item.type === 'movie' ? <Film aria-label="Film" className="h-3 w-3" /> : <Tv aria-label="Series" className="h-3 w-3" />}
                </span>
              </span>
              <span className="mt-1 truncate text-meta text-fg-2">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

export function RecentMediaTile() {
  const { data = [], isLoading } = useRecentlyWatched()
  const modal = useEntityModal()
  const latest = data[0]
  return (
    <GlanceTile
      label="Watched"
      icon={<Clapperboard />}
      loading={isLoading}
      value={latest ? latest.title : 'Nothing yet'}
      hint={latest ? fmtDateEnGB(new Date(latest.watched_at), { day: 'numeric', month: 'short' }) : 'Open Media'}
      {...(latest?.tmdbId != null ? { onClick: () => openMedia(modal, latest) } : { to: '/media' })}
    />
  )
}
