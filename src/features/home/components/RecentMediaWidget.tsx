import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../../integrations/supabase/client'
import { posterUrl } from '../../../integrations/tmdb/client'
import { haptic } from '../../../shared/utils/haptics'

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
      .from('user_tv_episodes')
      .select('id, watched_at, tv_entry_id, tv_entry:user_tv_entries(tv_series(title, poster_path))')
      .not('watched_at', 'is', null)
      .order('watched_at', { ascending: false })
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
      watched_at: e.watched_at,
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
  // Reference widget — collapsed by default on a phone (desktop always shows).
  const [collapsed, setCollapsed] = useState(true)

  if (isLoading) return null
  if (!data || data.length === 0) return null

  return (
    <div className="bg-cream-50 rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center min-w-0">
          <button
            type="button"
            onClick={() => { haptic('light'); setCollapsed(c => !c) }}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            className="sm:hidden text-ink-400 hover:text-ink-700 -ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide truncate">Recently Watched</h3>
        </div>
        <Link to="/media" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>
      {/* grid-cols-3 on mobile — 6 columns at ~390px squeezed posters down to
          ~60px with 9px titles, too cramped to read; 6 columns is kept from
          sm: up where there's actual room for it. Plain wrapper toggles mobile
          visibility so the inner grid's display type is untouched. */}
      <div className={collapsed ? 'hidden sm:block' : undefined}>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {data.map(item => (
          <Link key={item.id} to="/media" className="flex flex-col group press-feedback">
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
            <p className="text-[10px] sm:text-[9px] text-ink-600 truncate mt-0.5 leading-tight">{item.title}</p>
          </Link>
        ))}
      </div>
      </div>
    </div>
  )
}
