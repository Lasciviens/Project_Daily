import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../../integrations/supabase/client'
import { posterUrl } from '../../../integrations/tmdb/client'

interface RecentItem {
  id:         string
  type:       'movie' | 'tv'
  title:      string
  status:     string
  poster:     string | null
  created_at: string
}

async function fetchRecentMedia(): Promise<RecentItem[]> {
  const [movies, tv] = await Promise.all([
    supabase
      .from('user_movie_entries')
      .select('id, status, created_at, movie:movies(title, poster_path)')
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('user_tv_entries')
      .select('id, status, created_at, tv_series:tv_series(title, poster_path)')
      .order('created_at', { ascending: false })
      .limit(4),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const movieItems: RecentItem[] = (movies.data ?? []).map((m: any) => ({
    id:         m.id,
    type:       'movie' as const,
    title:      m.movie?.title ?? 'Unknown',
    status:     m.status,
    poster:     m.movie?.poster_path ?? null,
    created_at: m.created_at,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tvItems: RecentItem[] = (tv.data ?? []).map((s: any) => ({
    id:         s.id,
    type:       'tv' as const,
    title:      s.tv_series?.title ?? 'Unknown',
    status:     s.status,
    poster:     s.tv_series?.poster_path ?? null,
    created_at: s.created_at,
  }))

  return [...movieItems, ...tvItems]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6)
}

const STATUS_DOT: Record<string, string> = {
  watching:  'bg-green-400',
  wishlist:  'bg-amber-400',
  completed: 'bg-ink-300',
  dropped:   'bg-red-300',
  paused:    'bg-blue-400',
}

export function RecentMediaWidget() {
  const { data, isLoading } = useQuery({
    queryKey:  ['recent-media'],
    queryFn:   fetchRecentMedia,
    staleTime: 5 * 60_000,
  })

  if (isLoading) return null
  if (!data || data.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Recently Added</h3>
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
              <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${STATUS_DOT[item.status] ?? 'bg-ink-300'}`} />
            </div>
            <p className="text-[9px] text-ink-600 truncate mt-0.5 leading-tight">{item.title}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
