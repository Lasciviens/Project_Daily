import { useState } from 'react'
import { rp5 } from '../../../integrations/rp5-library/client'
import { useGameStats, useGames } from '../../home/hooks/useGames'
import type { Game } from '../../home/api/gamesApi'

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  playing:   'Playing',
  completed: 'Completed',
  wishlist:  'Wishlist',
  backlog:   'Backlog',
  dropped:   'Dropped',
}

const STATUS_COLOR: Record<string, string> = {
  playing:   'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  wishlist:  'bg-purple-100 text-purple-700',
  backlog:   'bg-ink-100 text-ink-500',
  dropped:   'bg-red-100 text-red-600',
}

const TIER_COLOR: Record<string, string> = {
  S: 'bg-yellow-400 text-yellow-900',
  A: 'bg-orange-400 text-white',
  B: 'bg-green-500 text-white',
  C: 'bg-blue-400 text-white',
  D: 'bg-ink-400 text-white',
  F: 'bg-red-500 text-white',
}

const FILTER_TABS = [
  { key: undefined,     label: 'All' },
  { key: 'playing',     label: '▶ Playing' },
  { key: 'wishlist',    label: '📋 Wishlist' },
  { key: 'backlog',     label: '🕹 Backlog' },
  { key: 'completed',   label: '✅ Done' },
  { key: 'dropped',     label: '✗ Dropped' },
]

// ─── GameCard ─────────────────────────────────────────────────────────────────

function GameCard({ game }: { game: Game }) {
  const [imgError, setImgError] = useState(false)
  const statusClass = STATUS_COLOR[game.play_status] ?? 'bg-ink-100 text-ink-500'
  const tierClass   = game.tier ? (TIER_COLOR[game.tier] ?? 'bg-ink-200 text-ink-700') : null

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden flex flex-col">
      {/* Cover */}
      <div className="relative aspect-[3/4] bg-ink-100 flex-shrink-0">
        {game.cover_url && !imgError ? (
          <img
            src={game.cover_url}
            alt={game.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-2">
            <span className="text-2xl">🎮</span>
          </div>
        )}
        {/* Corner badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
          {tierClass && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tierClass}`}>{game.tier}</span>
          )}
        </div>
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 items-end">
          {game.is_iconic && <span className="text-xs leading-none">⭐</span>}
          {game.is_coop  && <span className="text-[10px] bg-cyan-500 text-white font-bold px-1 rounded leading-tight">2P</span>}
        </div>
        {/* Rating overlay */}
        {game.igdb_rating && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
            {Math.round(Number(game.igdb_rating))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2 flex flex-col gap-1 flex-1">
        <p className="text-xs font-semibold text-ink-800 leading-snug line-clamp-2">{game.title}</p>
        <div className="flex items-center gap-1 flex-wrap mt-auto pt-1">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusClass}`}>
            {STATUS_LABEL[game.play_status] ?? game.play_status}
          </span>
          {game.release_year && (
            <span className="text-[10px] text-ink-400">{game.release_year}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GamesPage() {
  const [activeStatus, setActiveStatus] = useState<string | undefined>(undefined)
  const { data: stats, isLoading: statsLoading } = useGameStats()
  const { data: games = [], isLoading: gamesLoading } = useGames(activeStatus)

  if (!rp5) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-cream-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🎮</div>
          <h1 className="text-2xl font-bold text-ink-900 mb-2">Games</h1>
          <p className="text-sm text-ink-400">RP5 Supabase keys not configured</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-cream-50">
      <div className="max-w-5xl mx-auto px-4 py-5">

        {/* Header */}
        <h1 className="text-xl font-bold text-ink-900 mb-4">🎮 Games</h1>

        {/* Stats row */}
        {!statsLoading && stats && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
            {[
              { label: 'Total',     value: stats.total,     color: 'text-ink-900' },
              { label: 'Playing',   value: stats.playing,   color: 'text-orange-600' },
              { label: 'Done',      value: stats.completed, color: 'text-green-600' },
              { label: 'Wishlist',  value: stats.wishlist,  color: 'text-purple-600' },
              { label: 'Backlog',   value: stats.backlog,   color: 'text-ink-500' },
              { label: 'Dropped',   value: stats.dropped,   color: 'text-red-500' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-ink-200 p-3 text-center">
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap mb-4">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.label}
              onClick={() => setActiveStatus(tab.key)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors duration-150 min-h-[36px] ${
                activeStatus === tab.key
                  ? 'bg-accent-500 text-white border-accent-500'
                  : 'bg-white text-ink-600 border-ink-200 hover:border-accent-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Games grid */}
        {gamesLoading && <div className="text-sm text-ink-400 py-4">Loading…</div>}

        {!gamesLoading && games.length === 0 && (
          <div className="text-sm text-ink-400 py-4">No games found</div>
        )}

        {!gamesLoading && games.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {games.map(g => <GameCard key={g.id} game={g} />)}
          </div>
        )}
      </div>
    </div>
  )
}
