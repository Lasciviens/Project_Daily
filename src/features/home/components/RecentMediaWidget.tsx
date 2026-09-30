import { useState } from 'react'
import { Clapperboard, Film, Tv } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, EmptyState, Truncate } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useRecentlyWatched, type RecentlyWatchedItem } from '../../media/hooks/useRecentlyWatched'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'
import { TileDetail } from './TileDetail'
import { useTilePopup } from '../hooks/useTilePopup'
import { formatDate } from '../../../shared/utils/dateFormat'
import { isUnknownWatchedAt } from '../../media/trakt/traktDates'

function openMedia(modal: ReturnType<typeof useEntityModal>, item: RecentlyWatchedItem) {
  if (item.tmdbId != null) modal.open({ kind: 'media', tmdbId: item.tmdbId, mediaType: item.type })
}

/** Last watched titles; each poster opens that title's popup. */
export function RecentMediaWidget() {
  const ws = useWidgetState('recentMedia', { mobileCollapsed: true })
  return (
    <WidgetShell title="Recently watched" icon={<Clapperboard />} ws={ws} to="/media">
      <RecentMediaGrid enabled={!ws.collapsed} />
    </WidgetShell>
  )
}

/** The widget's body — also what the glance tile opens on a wide Home. */
function RecentMediaGrid({ enabled }: { enabled: boolean }) {
  const { data = [], isLoading } = useRecentlyWatched({ enabled })
  const modal = useEntityModal()

  return (
    <>
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
              <Truncate className="mt-1 text-meta text-fg-2">{item.title}</Truncate>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Phone: the latest title opens its own popup. Wide Home (where this tile
 * stands in for the widget): the whole recently-watched grid opens.
 */
export function RecentMediaTile() {
  const { data = [], isLoading } = useRecentlyWatched()
  const modal = useEntityModal()
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  const latest = data[0]
  const action = popup
    ? { onClick: () => setOpen(true) }
    : latest?.tmdbId != null ? { onClick: () => openMedia(modal, latest) } : { to: '/media' }
  return (
    <>
      <GlanceTile
        label="Watched"
        icon={<Clapperboard />}
        loading={isLoading}
        value={latest ? latest.title : 'Nothing yet'}
        hint={latest ? (isUnknownWatchedAt(latest.watched_at) ? 'Date unknown' : formatDate(latest.watched_at)) : 'Open Media'}
        {...action}
      />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Recently watched" to="/media" openLabel="Open Media">
          <RecentMediaGrid enabled />
        </TileDetail>
      )}
    </>
  )
}
