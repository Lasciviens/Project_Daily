import { useMemo, useState } from 'react'
import { Clapperboard, Film, Tv } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Skeleton, EmptyState, Truncate } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { useRecentlyWatched, type RecentlyWatchedItem } from '../../media/hooks/useRecentlyWatched'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import { readGlanceIndex } from './glanceIndex'
import { useTVSeries } from '../../media/hooks/useTVSeries'
import { useNextEpisode } from '../../media/hooks/useNextEpisode'
import { useAiringThisWeek } from '../../media/hooks/useAiringThisWeek'
import type { UserTVEntry } from '../../media/types'
import { TileDetail } from './TileDetail'
import { useTilePopup } from '../hooks/useTilePopup'
import { formatDate, formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { isUnknownWatchedAt } from '../../media/trakt/traktDates'
import { AiringThisWeek } from '../../media/components/AiringThisWeek'

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
      <div className="mb-2"><AiringThisWeek enabled={enabled} /></div>
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

/** The show you're watching that you touched last, and its next episode. */
function useWatchNext() {
  const { data: tv } = useTVSeries()
  const current = useMemo(() => {
    let best: UserTVEntry | null = null
    for (const e of tv ?? []) if (e.status === 'watching' && (!best || e.updated_at > best.updated_at)) best = e
    return best
  }, [tv])
  const { data: next } = useNextEpisode(current?.id ?? null, current?.tv_series.tmdb_id ?? null, current?.tv_series.number_of_episodes ?? null)
  return { current, next }
}

const se = (s: number, e: number) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`

/**
 * Glance tile with swipeable screens: last watched · watch next · airing
 * this week. Phone: a tap opens the title on the screen you're on (else
 * Media). Wide Home (the tile stands in for the widget): the whole
 * recently-watched grid opens.
 */
export function RecentMediaTile() {
  const { data = [], isLoading } = useRecentlyWatched()
  const { current, next } = useWatchNext()
  const airing = useAiringThisWeek()
  const modal = useEntityModal()
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  const latest = data[0]

  const screens: GlanceScreen[] = [{
    key: 'last',
    name: 'Last watched',
    body: (
      <div className="min-w-0 space-y-1">
        <Truncate className="text-ui font-semibold text-fg">{latest ? latest.title : 'Nothing yet'}</Truncate>
        <Truncate className="text-meta tabular-nums text-fg-muted">{latest ? (isUnknownWatchedAt(latest.watched_at) ? 'Date unknown' : formatDate(latest.watched_at)) : 'Open Media'}</Truncate>
      </div>
    ),
  }]
  if (current) {
    screens.push({
      key: 'next',
      name: 'Watch next',
      body: (
        <div className="min-w-0 space-y-1">
          <Truncate className="text-ui font-semibold text-fg">{current.tv_series.title}</Truncate>
          <Truncate className="text-meta tabular-nums text-fg-muted">
            {!next ? 'Checking…' : next.caughtUp ? 'All caught up' : `${se(next.season ?? 0, next.episode ?? 0)}${next.episodeTitle ? ` · ${next.episodeTitle}` : ''}${!next.released && next.airDate ? ` · out ${formatDate(next.airDate)}` : ''}`}
          </Truncate>
        </div>
      ),
    })
  }
  screens.push({
    key: 'airing',
    name: 'This week',
    body: (
      <div className="min-w-0 space-y-1">
        <p className="text-ui font-semibold tabular-nums text-fg">{airing.length === 0 ? 'No new episodes' : `${airing.length} new episode${airing.length === 1 ? '' : 's'}`}</p>
        <Truncate className="text-meta tabular-nums text-fg-muted">
          {airing[0] ? `${airing[0].title} ${se(airing[0].season, airing[0].episode)} · ${formatWeekdayDate(airing[0].airDate.slice(0, 10))}` : 'Of the shows you follow, next 7 days'}
        </Truncate>
      </div>
    ),
  })

  const openOnPhone = () => {
    const key = screens[Math.min(readGlanceIndex('media'), screens.length - 1)]?.key
    if (key === 'next' && current) return modal.open({ kind: 'media', tmdbId: current.tv_series.tmdb_id, mediaType: 'tv' })
    if (key === 'airing' && airing[0]) return modal.open({ kind: 'media', tmdbId: airing[0].tmdbId, mediaType: 'tv' })
    if (latest?.tmdbId != null) return openMedia(modal, latest)
  }
  const action = popup ? { onClick: () => setOpen(true) } : latest || current ? { onClick: openOnPhone } : { to: '/media' }
  return (
    <>
      <GlanceCarousel id="media" label="Watched" icon={<Clapperboard />} loading={isLoading} screens={screens} {...action} />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Recently watched" to="/media" openLabel="Open Media">
          <RecentMediaGrid enabled />
        </TileDetail>
      )}
    </>
  )
}
