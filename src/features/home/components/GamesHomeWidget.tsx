import { useMemo, useState } from 'react'
import { Gamepad2 } from 'lucide-react'
import { Skeleton, ToneDot, Button, type Tone } from '../../../shared/ui'
import { useGameStats, usePlayQueue } from '../../games/hooks/useGames'
import { computeGameStats } from '../../games/gameStats'
import type { Game, PlayStatus } from '../../games/types'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'

// Local until the games feature exports its own status → tone map.
const PLAY_STATUS_TONE: Record<PlayStatus, Tone> = {
  playing: 'info', completed: 'success', wishlist: 'highlight', backlog: 'neutral', dropped: 'danger', hidden: 'neutral',
}

function CoverThumb({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false)
  // The saved cover, else the primary copy's own (ES-DE rows often have only that).
  const url = game.primary_cover_url ?? (game.platforms?.find(p => p.is_primary_variant) ?? game.platforms?.[0])?.cover_url ?? null
  return (
    <div className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2" title={game.title}>
      {url && !failed
        ? <img src={url} alt={game.title} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        : <div className="grid h-full w-full place-items-center text-fg-faint"><Gamepad2 aria-hidden className="h-5 w-5" /></div>}
      <ToneDot tone={PLAY_STATUS_TONE[game.play_status] ?? 'neutral'} className="absolute bottom-1 right-1" />
    </div>
  )
}

/** Library totals without hidden rows (a Steam tool, something you hid). */
function useVisibleGameStats(enabled: boolean) {
  const q = useGameStats(enabled)
  const stats = useMemo(() => {
    if (!q.data) return null
    return computeGameStats(q.data.rows.filter(r => r.play_status !== 'hidden'), q.data.platforms)
  }, [q.data])
  return { ...q, stats }
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: Tone }) {
  return (
    <div className="min-w-0 flex-1 rounded-control bg-surface-2 px-1 py-2 text-center">
      <div data-tone={tone} className={tone ? 'tone-text text-lead font-bold tabular-nums' : 'text-lead font-bold tabular-nums text-fg'}>{value}</div>
      <div className="mt-0.5 text-micro text-fg-muted">{label}</div>
    </div>
  )
}

export function GamesHomeWidget() {
  const ws = useWidgetState('games', { mobileCollapsed: true })
  const { stats, isLoading, error, refetch } = useVisibleGameStats(!ws.collapsed)
  const { data: queue = [] } = usePlayQueue(!ws.collapsed)
  const playing = queue.filter(g => g.play_status === 'playing')

  return (
    <WidgetShell title="Games" icon={<Gamepad2 />} ws={ws} to="/games">
      {isLoading && <div className="flex gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 flex-1" />)}</div>}
      {error && !stats && (
        <div className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
          <span>Could not load your games.</span>
          <Button size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
      {stats && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Stat value={stats.playing} label="Playing" tone="info" />
            <Stat value={stats.total} label="Total" />
            <Stat value={stats.completed} label="Done" tone="success" />
          </div>
          {playing.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="section-label mb-2">Playing</p>
              <div className="scroll-x flex gap-2 pb-1">
                {playing.map(g => <CoverThumb key={g.id} game={g} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  )
}

export function GamesTile() {
  const { stats, isLoading } = useVisibleGameStats(true)
  return (
    <GlanceTile
      label="Games"
      icon={<Gamepad2 />}
      to="/games"
      loading={isLoading}
      value={<>{stats?.playing ?? 0}<span className="ml-1 text-meta font-medium text-fg-muted">playing</span></>}
      hint={stats ? `${stats.completed} of ${stats.total} done` : undefined}
    />
  )
}
