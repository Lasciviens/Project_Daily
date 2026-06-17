import { Link } from 'react-router-dom'
import { rp5 } from '../../../integrations/rp5-library/client'
import { useGameStats, useRecentGames } from '../hooks/useGames'

const STATUS_ICON: Record<string, string> = {
  playing:   '🎮',
  wishlist:  '📋',
  completed: '✅',
  dropped:   '🗑',
  on_hold:   '⏸',
}

function StatPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex-1 text-center bg-ink-50 rounded-lg py-2 px-1">
      <div className={`text-lg font-bold ${accent ? 'text-accent-600' : 'text-ink-900'}`}>{value}</div>
      <div className="text-[10px] text-ink-400 mt-0.5">{label}</div>
    </div>
  )
}

export function GamesHomeWidget() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useGameStats()
  const { data: recent = [] }                                        = useRecentGames(3)

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
          <div className="flex gap-2">
            <StatPill label="playing"   value={stats.playing}   accent />
            <StatPill label="wishlist"  value={stats.wishlist}  />
            <StatPill label="done"      value={stats.completed} />
          </div>

          {recent.length > 0 && (
            <div className="space-y-1.5 border-t border-ink-100 pt-2">
              {recent.map(g => (
                <div key={g.id} className="flex items-center gap-2">
                  <span className="text-sm flex-shrink-0">{STATUS_ICON[g.play_status] ?? '🎮'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-800 truncate">{g.title}</p>
                    {g.tier && (
                      <p className="text-[10px] text-ink-400">{g.tier}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
