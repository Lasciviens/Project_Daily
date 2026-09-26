import { useState, useMemo, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useGameStats, usePlayQueue } from '../../games/hooks/useGames'
import { computeGameStats } from '../../games/gameStats'
import type { Game } from '../../games/types'
import { haptic } from '../../../shared/utils/haptics'

const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-400',
  completed: 'bg-green-500',
  wishlist:  'bg-purple-500',
  backlog:   'bg-ink-300',
  dropped:   'bg-red-400',
}

// The widget's body shows from `sm` up regardless of the collapse toggle.
const DESKTOP = '(min-width: 640px)'
const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const isDesktopNow = () => window.matchMedia(DESKTOP).matches

function CoverThumb({ game }: { game: Game }) {
  const [err, setErr] = useState(false)
  // The saved cover, else the primary copy's own (ES-DE rows often have only that).
  const url = game.primary_cover_url ?? (game.platforms?.find(p => p.is_primary_variant) ?? game.platforms?.[0])?.cover_url ?? null
  return (
    <div className="relative flex-shrink-0 w-14 rounded-lg overflow-hidden border border-ink-200 bg-ink-100" style={{ aspectRatio: '3/4' }}>
      {url && !err ? (
        <img src={url} alt={game.title} onError={() => setErr(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-base">🎮</div>
      )}
      {/* Status dot */}
      <span className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-300'}`} />
    </div>
  )
}

export function GamesHomeWidget() {
  // Reference widget — collapsed by default on a phone (desktop always shows).
  const [collapsed, setCollapsed] = useState(true)
  const isDesktop = useSyncExternalStore(subscribeDesktop, isDesktopNow, () => true)
  // Collapsed on a phone, nothing is shown — so nothing is fetched (Home rule).
  const shown = !collapsed || isDesktop
  const { data: statsData, isLoading: statsLoading, error: statsError } = useGameStats(shown)
  // Plain all-time totals of the games you can see: a hidden row (a Steam
  // tool, something you hid) is not part of your library's numbers.
  const stats = useMemo(() => {
    if (!statsData) return null
    const rows = statsData.rows.filter(r => r.play_status !== 'hidden')
    return computeGameStats(rows, statsData.platforms)
  }, [statsData])
  const { data: queue = [] } = usePlayQueue(shown)
  const playingGames = queue.filter(g => g.play_status === 'playing')

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
          <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide truncate">Games</h3>
        </div>
        <Link to="/games" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>

      <div className={collapsed ? 'hidden sm:block' : undefined}>
      {statsLoading && (
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 flex-1 rounded-lg bg-cream-200 animate-pulse" />
          ))}
        </div>
      )}

      {statsError && (
        <div className="text-xs text-red-500 space-y-0.5">
          <div>Could not load games</div>
          <div className="text-[10px] text-red-400 break-all">{(statsError as Error).message}</div>
        </div>
      )}

      {!statsLoading && !statsError && stats && (
        <div className="space-y-3">
          {/* Stats pills */}
          <div className="flex gap-1.5">
            <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
              <div className="text-lg font-bold text-orange-600">{stats.playing}</div>
              <div className="text-[10px] text-ink-400 mt-0.5">Playing</div>
            </div>
            <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
              <div className="text-lg font-bold text-ink-900">{stats.total}</div>
              <div className="text-[10px] text-ink-400 mt-0.5">Total</div>
            </div>
            <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
              <div className="text-lg font-bold text-green-600">{stats.completed}</div>
              <div className="text-[10px] text-ink-400 mt-0.5">Done</div>
            </div>
          </div>

          {/* Cover thumbnails — only games currently being played */}
          {playingGames.length > 0 && (
            <div className="border-t border-ink-100 pt-2">
              <p className="text-[10px] text-ink-400 mb-2">Playing</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {playingGames.map(g => <CoverThumb key={g.id} game={g} />)}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
