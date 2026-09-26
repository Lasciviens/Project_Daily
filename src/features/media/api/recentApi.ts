import { supabase } from '../../../integrations/supabase/client'

export interface RecentlyWatchedItem {
  id:         string
  type:       'movie' | 'tv'
  /** TMDB id — what the `media` entity popup opens by. */
  tmdbId:     number | null
  title:      string
  poster:     string | null
  watched_at: string
}

interface MovieRow { id: string; watched_at: string; movie: { title: string; poster_path: string | null; tmdb_id: number } | null }
interface EpisodeRow {
  id: string; watched_at: string; tv_entry_id: string
  tv_entry: { tv_series: { title: string; poster_path: string | null; tmdb_id: number } | null } | null
}

/** Last watched titles: completed movies + the latest episode of each series. */
export async function fetchRecentlyWatched(limit = 6): Promise<RecentlyWatchedItem[]> {
  const [movies, episodes] = await Promise.all([
    supabase
      .from('user_movie_entries')
      .select('id, watched_at, movie:movies(title, poster_path, tmdb_id)')
      .not('watched_at', 'is', null)
      .order('watched_at', { ascending: false })
      .limit(4),
    supabase
      .from('user_tv_episodes')
      .select('id, watched_at, tv_entry_id, tv_entry:user_tv_entries(tv_series(title, poster_path, tmdb_id))')
      .not('watched_at', 'is', null)
      .order('watched_at', { ascending: false })
      .limit(12),
  ])
  if (movies.error) throw movies.error
  if (episodes.error) throw episodes.error

  const movieItems: RecentlyWatchedItem[] = ((movies.data ?? []) as unknown as MovieRow[]).map(m => ({
    id:         m.id,
    type:       'movie',
    tmdbId:     m.movie?.tmdb_id ?? null,
    title:      m.movie?.title ?? 'Unknown',
    poster:     m.movie?.poster_path ?? null,
    watched_at: m.watched_at,
  }))

  // One row per series — keep only the most recently watched episode of each.
  const seenSeries = new Set<string>()
  const episodeItems: RecentlyWatchedItem[] = []
  for (const e of (episodes.data ?? []) as unknown as EpisodeRow[]) {
    if (seenSeries.has(e.tv_entry_id)) continue
    seenSeries.add(e.tv_entry_id)
    const series = e.tv_entry?.tv_series
    episodeItems.push({
      id:         e.id,
      type:       'tv',
      tmdbId:     series?.tmdb_id ?? null,
      title:      series?.title ?? 'Unknown',
      poster:     series?.poster_path ?? null,
      watched_at: e.watched_at,
    })
  }

  return [...movieItems, ...episodeItems]
    .sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime())
    .slice(0, limit)
}
