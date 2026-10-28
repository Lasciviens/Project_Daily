import { supabase } from '../../../integrations/supabase/client'

export interface RecentlyWatchedItem {
  id:         string
  type:       'movie' | 'tv'
  /** TMDB id — what the `media` entity popup opens by. */
  tmdbId:     number | null
  title:      string
  poster:     string | null
  watched_at: string
  /** An episode's season and number (null for a film). */
  season:     number | null
  episode:    number | null
}

interface MovieRow { id: string; watched_at: string; movie: { title: string; poster_path: string | null; tmdb_id: number } | null }
interface EpisodeRow {
  id: string; watched_at: string; tv_entry_id: string; season_number: number; episode_number: number
  tv_entry: { tv_series: { title: string; poster_path: string | null; tmdb_id: number } | null } | null
}

const EPISODE_PAGE = 12

function episodeItem(e: EpisodeRow): RecentlyWatchedItem {
  const series = e.tv_entry?.tv_series
  return {
    id:         e.id,
    type:       'tv',
    tmdbId:     series?.tmdb_id ?? null,
    title:      series?.title ?? 'Unknown',
    poster:     series?.poster_path ?? null,
    watched_at: e.watched_at,
    season:     e.season_number,
    episode:    e.episode_number,
  }
}

/**
 * The latest episode of up to `limit` series, newest first. A whole season
 * marked at once fills a read with one series, so the next read leaves the
 * series already found out — at most `limit` reads.
 */
async function fetchLatestEpisodes(limit: number): Promise<RecentlyWatchedItem[]> {
  const seen = new Set<string>()
  const out: RecentlyWatchedItem[] = []
  for (let read = 0; read < limit && out.length < limit; read++) {
    const all = supabase
      .from('user_tv_episodes')
      .select('id, watched_at, tv_entry_id, season_number, episode_number, tv_entry:user_tv_entries(tv_series(title, poster_path, tmdb_id))')
    const rest = seen.size ? all.not('tv_entry_id', 'in', `(${[...seen].join(',')})`) : all
    const { data, error } = await rest
      .not('watched_at', 'is', null)
      .order('watched_at', { ascending: false })
      // Episodes marked at the same moment (a whole season at once): the higher one is the latest —
      // so the one-per-series pick below keeps it (the stable sort at the end keeps this order).
      .order('season_number', { ascending: false })
      .order('episode_number', { ascending: false })
      .limit(EPISODE_PAGE)
    if (error) throw error
    const rows = (data ?? []) as unknown as EpisodeRow[]
    for (const e of rows) {
      if (seen.has(e.tv_entry_id)) continue
      seen.add(e.tv_entry_id)
      out.push(episodeItem(e))
    }
    if (rows.length < EPISODE_PAGE) break
  }
  return out.slice(0, limit)
}

/** Last watched titles: completed movies + the latest episode of each series. */
export async function fetchRecentlyWatched(limit = 6): Promise<RecentlyWatchedItem[]> {
  const [movies, episodeItems] = await Promise.all([
    supabase
      .from('user_movie_entries')
      .select('id, watched_at, movie:movies(title, poster_path, tmdb_id)')
      .not('watched_at', 'is', null)
      .order('watched_at', { ascending: false })
      .limit(limit),
    fetchLatestEpisodes(limit),
  ])
  if (movies.error) throw movies.error

  const movieItems: RecentlyWatchedItem[] = ((movies.data ?? []) as unknown as MovieRow[]).map(m => ({
    id:         m.id,
    type:       'movie',
    tmdbId:     m.movie?.tmdb_id ?? null,
    title:      m.movie?.title ?? 'Unknown',
    poster:     m.movie?.poster_path ?? null,
    watched_at: m.watched_at,
    season:     null,
    episode:    null,
  }))

  return [...movieItems, ...episodeItems]
    .sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime())
    .slice(0, limit)
}
