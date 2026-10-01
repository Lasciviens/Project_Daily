import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { getBasic } from '../api/tmdbApi'
import { useTVSeries } from './useTVSeries'
import { useTraktCalendar } from '../trakt/useTraktExtras'
import { useTraktStatus } from '../trakt/useTrakt'

export interface AiringItem { key: string; tmdbId: number; title: string; poster: string | null; season: number; episode: number; episodeTitle: string | null; airDate: string }

const inWeek = (day: string, today: string, end: string) => day >= today && day <= end

/**
 * New episodes of your shows in the next 7 days. With Trakt: its "my shows"
 * calendar (everything you watched or watchlisted, finished shows too).
 * Without: TMDB's next episode of each show you're Watching, Paused or have
 * Completed — a finished show that gets a new season still shows up here.
 */
export function useAiringThisWeek(enabled = true) {
  const { data: tv = [] } = useTVSeries()
  const { data: trakt } = useTraktStatus()
  const cal = useTraktCalendar()
  // In-progress shows first; TMDB only has a next episode for a show still running.
  const following = [
    ...tv.filter(e => e.status === 'watching' || e.status === 'paused'),
    ...tv.filter(e => e.status === 'completed'),
  ].slice(0, 30)
  const useTmdb = enabled && !trakt?.connected
  const [range] = useState(() => ({ today: new Date().toISOString().slice(0, 10), end: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) }))
  const basics = useQueries({
    queries: following.map(e => ({
      queryKey: qk.media.tmdbQuery('basic', 'tv', e.tv_series.tmdb_id),
      queryFn: () => getBasic('tv', e.tv_series.tmdb_id),
      enabled: useTmdb,
      staleTime: STALE.day,
    })),
  })

  return useMemo(() => {
    const { today, end } = range
    const poster = new Map(tv.map(e => [e.tv_series.tmdb_id, e.tv_series.poster_path]))
    let items: AiringItem[]
    if (trakt?.connected) {
      items = (cal.data ?? [])
        .filter(c => c.tmdb && c.firstAired && c.season != null && c.episode != null && inWeek(new Date(c.firstAired).toLocaleDateString('sv-SE'), today, end))
        .map(c => ({ key: `${c.tmdb}:${c.season}:${c.episode}`, tmdbId: c.tmdb!, title: c.showTitle, poster: poster.get(c.tmdb!) ?? null, season: c.season!, episode: c.episode!, episodeTitle: c.episodeTitle, airDate: c.firstAired! }))
    } else {
      items = basics.flatMap((q, i) => {
        const n = q.data?.next_episode_to_air
        const e = following[i]
        if (!n?.air_date || !inWeek(n.air_date, today, end)) return []
        return [{ key: `${e.tv_series.tmdb_id}:${n.season_number}:${n.episode_number}`, tmdbId: e.tv_series.tmdb_id, title: e.tv_series.title, poster: e.tv_series.poster_path, season: n.season_number, episode: n.episode_number, episodeTitle: n.name || null, airDate: n.air_date }]
      })
    }
    return items.sort((a, b) => a.airDate.localeCompare(b.airDate))
  }, [trakt?.connected, cal.data, basics, following, tv, range])
}
