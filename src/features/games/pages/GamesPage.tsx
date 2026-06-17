import { rp5 } from '../../../integrations/rp5-library/client'
import { useGameStats, useRecentGames } from '../../home/hooks/useGames'

const STATUS_ICON: Record<string, string> = {
  playing:   '🎮',
  wishlist:  '📋',
  completed: '✅',
  dropped:   '🗑',
  on_hold:   '⏸',
}

const STATUS_LABEL: Record<string, string> = {
  playing:   'Playing',
  wishlist:  'Wishlist',
  completed: 'Completed',
  dropped:   'Dropped',
  on_hold:   'On Hold',
}

export function GamesPage() {
  const { data: stats, isLoading: statsLoading } = useGameStats()
  const { data: recent = [], isLoading: recentLoading } = useRecentGames(20)

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

  const isLoading = statsLoading || recentLoading

  return (
    <div className="min-h-[calc(100vh-56px)] bg-cream-50 p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-ink-900 mb-4">Games</h1>

      {isLoading && (
        <div className="text-ink-400 text-sm">Loading…</div>
      )}

      {!isLoading && stats && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'Playing',   value: stats.playing,   icon: '🎮' },
              { label: 'Wishlist',  value: stats.wishlist,  icon: '📋' },
              { label: 'Completed', value: stats.completed, icon: '✅' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-ink-200 shadow-sm p-4 text-center">
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="text-2xl font-bold text-ink-900">{s.value}</div>
                <div className="text-xs text-ink-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Games list */}
          {recent.length > 0 && (
            <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4">
              <h2 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-3">
                Library
              </h2>
              <div className="space-y-2">
                {recent.map(g => (
                  <div key={g.id} className="flex items-center gap-3 py-1.5 border-b border-ink-50 last:border-0">
                    <span className="text-xl flex-shrink-0">{STATUS_ICON[g.play_status] ?? '🎮'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-800 truncate">{g.title}</p>
                      {g.tier && (
                        <p className="text-[10px] text-ink-400">{g.tier}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-ink-400 flex-shrink-0">
                      {STATUS_LABEL[g.play_status] ?? g.play_status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
