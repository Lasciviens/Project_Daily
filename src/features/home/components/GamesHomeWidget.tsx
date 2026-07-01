import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rp5 } from '../../../integrations/rp5-library/client'
import { useGameStats, usePlayQueue } from '../hooks/useGames'
import type { Game } from '../api/gamesApi'

const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-400',
  completed: 'bg-green-500',
  wishlist:  'bg-purple-500',
  backlog:   'bg-ink-300',
  dropped:   'bg-red-400',
}

function CoverThumb({ game }: { game: Game }) {
  const [err, setErr] = useState(false)
  return (
    <div className="relative flex-shrink-0 w-14 rounded-lg overflow-hidden border border-ink-200 bg-ink-100" style={{ aspectRatio: '3/4' }}>
      {game.cover_url && !err ? (
        <img src={game.cover_url} alt={game.title} onError={() => setErr(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-base">🎮</div>
      )}
      {/* Status dot */}
      <span className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${STATUS_COLOR[game.play_status] ?? 'bg-ink-300'}`} />
      {game.tier && (
        <span className="absolute top-1 left-1 text-[8px] font-bold bg-black/60 text-white px-1 rounded leading-tight">{game.tier}</span>
      )}
    </div>
  )
}

export function GamesHomeWidget() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useGameStats()
  const { data: queue  = [] } = usePlayQueue()
  const playingGames = queue.filter(g => g.play_status === 'playing')

  if (!rp5) {
    return (
      <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Games</h3>
          <Link to="/games" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎮</span>
          <div>
            <p className="text-sm font-medium text-ink-800">Not configured</p>
            <p className="text-xs text-ink-400">Add RP5 Supabase keys to enable</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Games</h3>
        <Link to="/games" className="text-xs text-accent-600 hover:text-accent-700">Open →</Link>
      </div>

      {statsLoading && <div className="text-ink-400 text-sm">Loading…</div>}

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
              <div className="text-lg font-bold text-ink-900">{stats.backlog + stats.wishlist}</div>
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
  )
}
