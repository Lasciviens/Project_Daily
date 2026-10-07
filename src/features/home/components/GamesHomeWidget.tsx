import { useMemo, useState } from 'react'
import { Gamepad2 } from 'lucide-react'
import { Skeleton, ToneDot, Button, Truncate, type Tone, AnimatedNumber } from '../../../shared/ui'
import { useGameStats, usePlayQueue } from '../../games/hooks/useGames'
import { computeGameStats } from '../../games/gameStats'
import { useGamesPrefs } from '../../games/prefs/useGamesPrefs'
import { derivePlatformKey } from '../../games/test-game/testGameModel'
import type { Game } from '../../games/types'
import { PLAY_STATUS_TONE } from '../../games/playStatusTones'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import { TileDetail } from './TileDetail'
import { useTilePopup } from '../hooks/useTilePopup'


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

/** Library totals without hidden rows (a Steam tool, something you hid) or left-out platforms. */
function useVisibleGameStats(enabled: boolean) {
  const q = useGameStats(enabled)
  const excluded = useGamesPrefs().prefs.excludedPlatforms
  const stats = useMemo(() => {
    if (!q.data) return null
    const out = new Set(excluded)
    const byGame = new Map<string, Game['platforms']>()
    for (const p of q.data.platforms) byGame.set(p.game_id, [...(byGame.get(p.game_id) ?? []), p as NonNullable<Game['platforms']>[number]])
    const counted = q.data.rows.filter(r => r.play_status !== 'hidden'
      && (out.size === 0 || !out.has(derivePlatformKey({ library: r.library, platforms: byGame.get(r.id) } as Game))))
    return computeGameStats(counted, q.data.platforms)
  }, [q.data, excluded])
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
  return (
    <WidgetShell title="Games" icon={<Gamepad2 />} ws={ws} to="/games">
      <GamesSummary enabled={!ws.collapsed} />
    </WidgetShell>
  )
}

/** The widget's body — also what the glance tile opens on a wide Home. */
function GamesSummary({ enabled }: { enabled: boolean }) {
  const { stats, isLoading, error, refetch } = useVisibleGameStats(enabled)
  const { data: queue = [] } = usePlayQueue(enabled)
  const playing = queue.filter(g => g.play_status === 'playing')

  return (
    <>
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
    </>
  )
}

/** Glance tile with swipeable screens: playing · up next in the queue · the library. */
export function GamesTile() {
  const { stats, isLoading } = useVisibleGameStats(true)
  const { data: queue = [] } = usePlayQueue(true)
  const popup = useTilePopup()
  const [open, setOpen] = useState(false)
  const playing = queue.filter(g => g.play_status === 'playing')
  const upNext = queue.find(g => g.play_status !== 'playing' && g.play_status !== 'completed' && g.play_status !== 'dropped')
  const screens: GlanceScreen[] = [
    {
      key: 'playing',
      name: 'Playing',
      body: (
        <div className="min-w-0 space-y-1">
          <p className="flex items-baseline gap-1 text-title font-bold tabular-nums text-fg"><AnimatedNumber value={stats?.playing ?? 0} /><span className="text-meta font-medium text-fg-muted">playing</span></p>
          <Truncate className="text-meta text-fg-2">{playing.length ? playing.map(g => g.title).join(', ') : 'Nothing in progress'}</Truncate>
        </div>
      ),
    },
  ]
  if (upNext) {
    screens.push({
      key: 'next',
      name: 'Up next',
      body: (
        <div className="min-w-0 space-y-1">
          <Truncate className="text-ui font-semibold text-fg">{upNext.title}</Truncate>
          <Truncate className="text-meta text-fg-muted">{`Play queue · ${queue.length} game${queue.length === 1 ? '' : 's'}`}</Truncate>
        </div>
      ),
    })
  }
  if (stats) {
    screens.push({
      key: 'library',
      name: 'Library',
      value: <span className="flex items-baseline gap-1">{stats.completed}<span className="text-meta font-medium text-fg-muted">of {stats.total} done</span></span>,
      hint: `${stats.total ? Math.round((stats.completed / stats.total) * 100) : 0}% of your library finished`,
    })
  }
  return (
    <>
      <GlanceCarousel
        id="games"
        label="Games"
        icon={<Gamepad2 />}
        {...(popup ? { onClick: () => setOpen(true) } : { to: '/games' })}
        loading={isLoading}
        screens={screens}
      />
      {popup && (
        <TileDetail open={open} onClose={() => setOpen(false)} title="Games" to="/games" openLabel="Open Games">
          <GamesSummary enabled />
        </TileDetail>
      )}
    </>
  )
}
