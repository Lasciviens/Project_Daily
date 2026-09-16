import { useState, useMemo } from 'react'
import { useGameStats } from '../hooks/useGames'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import {
  formatPlaytime, computeGameStats, withinWindow, STATS_WINDOWS, LIBRARY_LABEL,
  type StatsWindow,
} from '../gameStats'
import { systemMeta } from '../systemMeta'

// New feature — a small stats/dashboard view over the library (total, by
// status, average personal rating, and a per-system breakdown). Computed
// entirely from already-fetched data (useGameStats does the aggregation in
// gamesApi.ts, not a SQL view — this app's own established pattern).
export function StatsPanel() {
  const { data, isLoading } = useGameStats()
  const [window, setWindow] = useState<StatsWindow>('all')
  const [libraries, setLibraries] = useState<string[]>([])

  // Its own useMemo so the two below get a stable dependency — a fresh []
  // every render would recompute the whole library's totals on every keypress
  // anywhere in the tree.
  const rows = useMemo(() => data?.rows ?? [], [data?.rows])
  // Which libraries actually have rows — no point offering Steam before a
  // single Steam game has been imported. Pre-096 every row reads as retro.
  const libraryOptions = useMemo(
    () => [...new Set(rows.map(r => r.library ?? 'retro'))].sort(),
    [rows],
  )
  const stats = useMemo(() => {
    const scoped = rows.filter(r => !libraries.length || libraries.includes(r.library ?? 'retro'))
    return computeGameStats(withinWindow(scoped, window), data?.platforms ?? [])
  }, [rows, libraries, window, data?.platforms])

  if (isLoading) return <div className="text-sm text-ink-400 py-8 text-center">Loading stats…</div>
  if (!data) return null

  const windowSpec = STATS_WINDOWS.find(w => w.key === window)

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
  const { playtime } = stats
  const maxPlayed = Math.max(1, ...playtime.topPlayed.map(t => t.seconds))
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-6">
      {/* Scope, above everything it changes. */}
      <div className="rounded-xl border border-ink-200 bg-cream-50 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mr-1">Period</span>
          {STATS_WINDOWS.map(w => (
            <button key={w.key} type="button" onClick={() => setWindow(w.key)}
              className={`min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                window === w.key ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
              }`}>{w.label}</button>
          ))}
        </div>
        {libraryOptions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide mr-1">Platform</span>
            {libraryOptions.map(lib => {
              const on = libraries.includes(lib)
              return (
                <button key={lib} type="button"
                  onClick={() => setLibraries(prev => on ? prev.filter(x => x !== lib) : [...prev, lib])}
                  className={`min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                    on ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
                  }`}>{LIBRARY_LABEL[lib] ?? lib}</button>
              )
            })}
            {libraries.length > 0 && (
              <button type="button" onClick={() => setLibraries([])} className="min-h-[36px] px-2 text-xs text-ink-500 underline">All</button>
            )}
          </div>
        )}
        {windowSpec?.days != null && (
          <p className="text-[11px] text-ink-400">
            Showing the {stats.total} game{stats.total === 1 ? '' : 's'} you played in this period, with their
            lifetime totals. Steam, PlayStation and ES-DE all report a lifetime total and a last-played
            date — none of them records per-session times, so hours cannot be split by period.
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {tiles.map(t => (
          <div key={t.label} className="bg-cream-50 rounded-xl border border-ink-200 p-2.5 text-center">
            <div className={`text-lg font-bold ${t.color}`}>{t.value}</div>
            <div className="text-[10px] text-ink-400">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Play time — the one part of this library that is measured rather than
          entered by hand, and until now it only ever appeared inside a single
          game's detail modal. */}
      <div className="bg-cream-50 rounded-xl border border-ink-200 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Play time</h3>
          <InfoBubble label="Where from?">
            Recorded by EmulationStation-DE on the handheld and synced here. It only
            covers sessions launched through ES-DE — a game played elsewhere shows
            as unplayed, which is why this says "no recorded play" rather than "never played".
          </InfoBubble>
        </div>
        {playtime.totalSeconds === 0 && playtime.playedCount === 0 ? (
          <p className="text-xs text-ink-400">No play data has been synced yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <div className="text-center">
                <div className="text-lg font-bold text-accent-600">{formatPlaytime(playtime.totalSeconds) ?? '—'}</div>
                <div className="text-[10px] text-ink-400">Total logged</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-ink-900">{playtime.playedCount}</div>
                <div className="text-[10px] text-ink-400">Played at least once</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-ink-500">{playtime.neverPlayedCount}</div>
                <div className="text-[10px] text-ink-400">No recorded play</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-ink-900 pt-1">{playtime.lastPlayed ? fmtDay(playtime.lastPlayed) : '—'}</div>
                <div className="text-[10px] text-ink-400">Last played</div>
              </div>
            </div>
            {playtime.topPlayed.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide">Most played</p>
                {playtime.topPlayed.map(t => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="text-xs text-ink-700 w-36 sm:w-48 truncate flex-shrink-0" title={t.title}>{t.title}</span>
                    <div className="flex-1 h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div className="h-full bg-accent-400 rounded-full" style={{ width: `${(t.seconds / maxPlayed) * 100}%` }} />
                    </div>
                    <span className="text-xs text-ink-500 w-16 text-right flex-shrink-0">{formatPlaytime(t.seconds)}</span>
                    {t.playcount != null && <span className="text-[10px] text-ink-400 w-8 text-right flex-shrink-0">{t.playcount}×</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
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
                  <span className="text-xs text-ink-600 w-20 truncate flex-shrink-0">{systemMeta(s.system).label}</span>
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
