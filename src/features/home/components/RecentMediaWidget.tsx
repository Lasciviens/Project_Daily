import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../../integrations/supabase/client'
import { posterUrl } from '../../../integrations/tmdb/client'

interface RecentItem {
  id:          string
  type:        'movie' | 'tv'
  title:       string
  poster:      string | null
  watched_at:  string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows<T>(res: { data: T[] | null }): any[] { return res.data ?? [] }

async function fetchRecentlyWatched(): Promise<RecentItem[]> {
  const [movies, episodes] = await Promise.all([
    supabase
      .from('user_movie_entries')
      .select('id, watched_at, movie:movies(title, poster_path)')
      .not('watched_at', 'is', null)
      .order('watched_at', { ascending: false })
      .limit(4),
    supabase
      .from('watched_episodes')
      .select('id, watched_on, tv_entry_id, tv_entry:user_tv_entries(tv_series(title, poster_path))')
      .order('watched_on', { ascending: false })
      .limit(12),
  ])

  const movieItems: RecentItem[] = rows(movies).map(m => ({
    id:         m.id,
    type:       'movie' as const,
    title:      m.movie?.title ?? 'Unknown',
    poster:     m.movie?.poster_path ?? null,
    watched_at: m.watched_at,
  }))

  // One row per series — keep only the most recently watched episode of each.
  const seenSeries = new Set<string>()
  const episodeItems: RecentItem[] = []
  for (const e of rows(episodes)) {
    if (seenSeries.has(e.tv_entry_id)) continue
    seenSeries.add(e.tv_entry_id)
    episodeItems.push({
      id:         e.id,
      type:       'tv' as const,
      title:      e.tv_entry?.tv_series?.title ?? 'Unknown',
      poster:     e.tv_entry?.tv_series?.poster_path ?? null,
      watched_at: e.watched_on,
    })
  }

  return [...movieItems, ...episodeItems]
    .sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime())
    .slice(0, 6)
}

export function RecentMediaWidget() {
  const { data, isLoading } = useQuery({
    queryKey:  ['recent-media', 'watched'],
    queryFn:   fetchRecentlyWatched,
    staleTime: 5 * 60_000,
  })

  if (isLoading) return null
  if (!data || data.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Recently Watched</h3>
        <Link to="/media" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {data.map(item => (
          <Link key={item.id} to="/media" className="flex flex-col group">
            <div className="relative aspect-[2/3] rounded overflow-hidden bg-ink-100">
              <img
                src={posterUrl(item.poster, 'w154')}
                alt={item.title}
                className="w-full h-full object-cover group-hover:brightness-90 transition-all duration-150"
                loading="lazy"
              />
              <span className={`absolute top-1 right-1 text-[8px] font-bold px-1 rounded ${item.type === 'movie' ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white'}`}>
                {item.type === 'movie' ? '🎬' : '📺'}
              </span>
            </div>
            <p className="text-[9px] text-ink-600 truncate mt-0.5 leading-tight">{item.title}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
