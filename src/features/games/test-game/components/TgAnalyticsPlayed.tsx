import { History, Hourglass } from 'lucide-react'
import { formatPlaytime } from '../../api/playtimeFormat'
import { formatDay, platformInfo } from '../testGameModel'
import type { TgaPlayed } from './tgAnalyticsModel'
import { TgCover } from './TgCover'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

const FRAME = 'relative overflow-hidden bg-[var(--tg-panel-2)] ring-1 ring-[var(--tg-border)] shadow-[shadow:var(--tg-cover-shadow)]'

// Columns follow the card, and the item count follows the columns so no row
// is left half-empty: 3×2 narrow, 4×2 in a monitor's one-column card, 6×1 wide.
const RECENT_GRID = [
  'grid grid-cols-3 gap-x-3 gap-y-4 [&>li:nth-child(n+7)]:hidden',
  '@[26rem]:grid-cols-4 @[26rem]:[&>li:nth-child(n+7)]:block',
  '@[40rem]:grid-cols-6 @[40rem]:gap-x-4 @[40rem]:[&>li:nth-child(n+7)]:hidden',
].join(' ')

const hours = (seconds: number | null) => (seconds ? formatPlaytime(seconds / 60) : '—')

/** The eight games with the most recorded time, with a thin bar for their share of the leader. */
export function TgAnalyticsMostPlayed({ items }: { items: TgaPlayed[] }) {
  const top = items[0]?.seconds ?? 1
  return (
    <TgAnalyticsCard label="Most played" meta={items.length ? 'lifetime play time' : undefined}>
      {items.length ? (
        <ol className="flex flex-col">
          {items.map(({ game, seconds, last }, i) => (
            <li key={game.id} className="grid grid-cols-[1.1rem_32px_minmax(0,1fr)_auto] items-center gap-x-3 py-1">
              <span className="text-right text-[12px] font-semibold tabular-nums text-[var(--tg-faint)]">{i + 1}</span>
              <span className={`${FRAME} h-11 w-8 rounded-[5px]`}>
                <TgCover game={game} mode="contain" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-[var(--tg-text)]">{game.title}</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tg-muted)]">
                  {platformInfo(game.platformKey).short}
                  {last && <> · last played {formatDay(last)}</>}
                </span>
                <span aria-hidden className="mt-1 block h-[3px] rounded-full bg-[var(--tg-accent)] opacity-80" style={{ width: `max(4px, ${((seconds ?? 0) / top) * 100}%)` }} />
              </span>
              <span className="self-start pt-px text-right text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{hours(seconds)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <TgAnalyticsEmpty icon={Hourglass} title="No play time recorded" hint="ES-DE, Steam and PlayStation report hours here after their next sync." />
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
              <span className={`${FRAME} block aspect-[0.72] w-full rounded-lg`}>
                <TgCover game={game} mode="contain" />
              </span>
              <p className="mt-2 truncate text-[12px] font-medium text-[var(--tg-text)]" title={game.title}>{game.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--tg-muted)]">
                {formatDay(last)}
                {seconds ? <span className="text-[var(--tg-faint)]"> · {hours(seconds)}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <TgAnalyticsEmpty icon={History} title="No recent sessions" hint="Games you play show up here, newest first." />
      )}
    </TgAnalyticsCard>
  )
}
