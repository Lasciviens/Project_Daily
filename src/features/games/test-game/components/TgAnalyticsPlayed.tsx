import { useState } from 'react'
import { History, Hourglass, Rocket } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import { formatDay, type TgGame } from '../testGameModel'
import type { TgaPlayed } from './tgAnalyticsModel'
import { fmtHours } from './tgAnalyticsData'
import { plural } from './tgAnalyticsFormat'
import { playedSubline } from './tgAnalyticsPlay'
import { TgCover } from './TgCover'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgSegmented } from './scrape/TgScrapeParts'
import { openGameFromAnalytics } from './tgAnalyticsOpen'

const PRESS = 'rounded-[10px] text-left transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]'

const FRAME = 'relative overflow-hidden bg-[var(--tg-panel-2)] ring-1 ring-[var(--tg-border)] shadow-[shadow:var(--tg-cover-shadow)]'

// Columns follow the card, and the item count follows the columns so no row
// is left half-empty: 3×2 narrow, 4×2 in a monitor's one-column card, 6×1 wide.
const RECENT_GRID = [
  'grid grid-cols-3 gap-x-3 gap-y-4 [&>li:nth-child(n+7)]:hidden',
  '@[26rem]:grid-cols-4 @[26rem]:[&>li:nth-child(n+7)]:block',
  '@[40rem]:grid-cols-6 @[40rem]:gap-x-4 @[40rem]:[&>li:nth-child(n+7)]:hidden',
].join(' ')

const hours = (seconds: number | null) => (seconds ? formatPlaytime(seconds / 60) : '—')

type Rank = 'time' | 'launches'
const RANKS: { value: Rank; label: string }[] = [{ value: 'time', label: 'Play time' }, { value: 'launches', label: 'Launches' }]

interface Launched { game: TgGame; launches: number; seconds: number | null; last: string | null }
interface Line { game: TgGame; last: string | null; amount: number; value: string }

function Row({ line, rank, top, mode }: { line: Line; rank: number; top: number; mode: Rank }) {
  const { game, last, amount, value } = line
  const sub = playedSubline(game, last, fmtHours, mode)
  return (
    <li>
      <button type="button" onClick={() => openGameFromAnalytics(game.id)} aria-label={`${game.title}, ${value}. Open details`}
        className={`${PRESS} -mx-2 grid w-[calc(100%+1rem)] grid-cols-[1.1rem_32px_minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-1`}>
        <span className="text-right text-[12px] font-semibold tabular-nums text-[var(--tg-faint)]">{rank}</span>
        <span className={`${FRAME} h-11 w-8 rounded-[5px]`}>
          <TgCover game={game} mode="contain" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-[var(--tg-text)]">{game.title}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tg-muted)]" title={sub}>{sub}</span>
          <span aria-hidden className="mt-1 block h-[3px] rounded-full bg-[var(--tg-accent)] opacity-80" style={{ width: `max(4px, ${(amount / top) * 100}%)` }} />
        </span>
        <span className="self-start whitespace-nowrap pt-px text-right text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{value}</span>
      </button>
    </li>
  )
}

/**
 * The games with the most recorded time — or, switched, the most launches
 * (ES-DE and PlayStation count them; Steam doesn't). A thin bar under each
 * title is its share of the leader.
 */
export function TgAnalyticsMostPlayed({ items, launched }: { items: TgaPlayed[]; launched: Launched[] }) {
  const [mode, setMode] = useState<Rank>('time')
  const lines: Line[] = mode === 'time'
    ? items.map(x => ({ game: x.game, last: x.last, amount: x.seconds ?? 0, value: hours(x.seconds) }))
    : launched.map(x => ({ game: x.game, last: x.last, amount: x.launches, value: plural(x.launches, 'launch', 'launches') }))
  const top = lines[0]?.amount || 1
  const any = items.length > 0 || launched.length > 0

  return (
    <TgAnalyticsCard label="Most played" meta={lines.length ? (mode === 'time' ? 'lifetime play time' : 'lifetime launches') : undefined}>
      {any && <TgSegmented size="sm" label="Rank games by" value={mode} options={RANKS} onChange={setMode} />}
      {lines.length ? (
        <ol className="mt-3 flex flex-col">
          {lines.map((line, i) => <Row key={line.game.id} line={line} rank={i + 1} top={top} mode={mode} />)}
        </ol>
      ) : mode === 'launches' ? (
        <TgAnalyticsEmpty icon={Rocket} className="mt-3" title="No launches recorded" hint="ES-DE and PlayStation count them, Steam doesn’t." />
      ) : (
        <TgAnalyticsEmpty icon={Hourglass} className={any ? 'mt-3' : ''} title="No play time recorded" hint="ES-DE, Steam and PlayStation report hours here after their next sync." />
      )}
    </TgAnalyticsCard>
  )
}

/** The latest sessions as covers — a grid that wraps, never a sideways scroller. */
export function TgAnalyticsRecent({ items, className = '' }: { items: TgaPlayed[]; className?: string }) {
  return (
    <TgAnalyticsCard label="Recently played" meta={items.length ? 'latest session first' : undefined} className={className}>
      {items.length ? (
        <ul className={RECENT_GRID}>
          {items.map(({ game, seconds, last }) => (
            <li key={game.id} className="min-w-0">
              <button type="button" onClick={() => openGameFromAnalytics(game.id)} aria-label={`${game.title}. Open details`}
                className="group block w-full rounded-lg text-left">
              <span className={`${FRAME} block aspect-[0.72] w-full rounded-lg transition-[filter] [@media(hover:hover)]:group-hover:brightness-110`}>
                <TgCover game={game} mode="contain" />
              </span>
              <span className="mt-2 block truncate text-[12px] font-medium text-[var(--tg-text)]" title={game.title}>{game.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--tg-muted)]">
                {formatDay(last)}
                {seconds ? <span className="text-[var(--tg-faint)]"> · {hours(seconds)}</span> : null}
              </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <TgAnalyticsEmpty icon={History} title="No recent sessions" hint="Games you play show up here, newest first." />
      )}
    </TgAnalyticsCard>
  )
}
