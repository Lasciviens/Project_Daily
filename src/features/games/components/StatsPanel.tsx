import { useGameStats } from '../hooks/useGames'
import { InfoBubble } from '../../../shared/components/InfoBubble'

// New feature — a small stats/dashboard view over the library (total, by
// status, average personal rating, and a per-system breakdown). Computed
// entirely from already-fetched data (useGameStats does the aggregation in
// gamesApi.ts, not a SQL view — this app's own established pattern).
export function StatsPanel() {
  const { data: stats, isLoading } = useGameStats()

  if (isLoading) return <div className="text-sm text-ink-400 py-8 text-center">Loading stats…</div>
  if (!stats) return null

  const tiles = [
    { label: 'Total',        value: stats.total,      color: 'text-ink-900' },
    { label: 'Playing',      value: stats.playing,    color: 'text-orange-600' },
    { label: 'Completed',    value: stats.completed,  color: 'text-green-600' },
    { label: 'Wishlist',     value: stats.wishlist,   color: 'text-purple-600' },
    { label: 'Backlog',      value: stats.backlog,    color: 'text-ink-500' },
    { label: 'Dropped',      value: stats.dropped,    color: 'text-red-500' },
    { label: 'Iconic',       value: stats.iconic,     color: 'text-yellow-600' },
    { label: 'Co-op',        value: stats.coop,       color: 'text-cyan-600' },
  ]

  const maxSystemCount = Math.max(1, ...stats.bySystem.map(s => s.count))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {tiles.map(t => (
          <div key={t.label} className="bg-cream-50 rounded-xl border border-ink-200 p-2.5 text-center">
            <div className={`text-lg font-bold ${t.color}`}>{t.value}</div>
            <div className="text-[10px] text-ink-400">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-cream-50 rounded-xl border border-ink-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wide">By system</h3>
            <InfoBubble label="What is this?">
              How many games (across all their platform variants) are catalogued per system — the same "system" you set on a game's platform entry.
            </InfoBubble>
          </div>
          {stats.bySystem.length === 0 ? (
            <p className="text-xs text-ink-400">No platforms recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {stats.bySystem.map(s => (
                <div key={s.system} className="flex items-center gap-2">
                  <span className="text-xs text-ink-600 w-20 truncate flex-shrink-0">{s.system}</span>
                  <div className="flex-1 h-2 bg-ink-100 rounded-full overflow-hidden">
                    <div className="h-full bg-accent-400 rounded-full" style={{ width: `${(s.count / maxSystemCount) * 100}%` }} />
                  </div>
                  <span className="text-xs text-ink-400 w-6 text-right flex-shrink-0">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-cream-50 rounded-xl border border-ink-200 p-4 flex flex-col items-center justify-center text-center">
          <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">Average personal rating</h3>
          {stats.avgRating != null ? (
            <p className="text-3xl font-bold text-accent-600">★ {stats.avgRating}</p>
          ) : (
            <p className="text-xs text-ink-400">Rate a few games to see this.</p>
          )}
          {stats.needsReview > 0 && (
            <p className="text-[11px] text-orange-600 mt-3">{stats.needsReview} game{stats.needsReview !== 1 ? 's' : ''} flagged for review</p>
          )}
        </div>
      </div>
    </div>
  )
}
