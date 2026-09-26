import { formatDay, lastPlayedIso, platformInfo, starsFromRating, type TgGame } from '../testGameModel'
import type { TgaTile } from './tgAnalyticsModel'
import { hoursOf } from './tgAnalyticsDrillCopy'
import { TgCover } from './TgCover'
import { TgStars } from './TgStars'

const FRAME = 'relative overflow-hidden bg-[var(--tg-panel-2)] ring-1 ring-[var(--tg-border)]'

/** The right-hand figure for a row: what this tile is about. */
function Figure({ kind, game }: { kind: TgaTile; game: TgGame }) {
  if (kind === 'rating') {
    const stars = starsFromRating(game.rating) ?? 0
    return (
      <span className="flex flex-col items-end gap-1">
        <span className="text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{stars.toFixed(1)}</span>
        <TgStars stars={stars} size={11} />
      </span>
    )
  }
  if (kind === 'completed') {
    return <span className="text-[12.5px] font-semibold tabular-nums text-[var(--tg-text)]">{game.finished_at ? formatDay(game.finished_at) : 'No date'}</span>
  }
  return <span className="text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{hoursOf(game) ?? '—'}</span>
}

/** The muted second line: platform, then whatever the figure doesn't already say. */
function detail(kind: TgaTile, game: TgGame): string {
  const parts = [platformInfo(game.platformKey).short]
  const last = lastPlayedIso(game)
  if (kind === 'completed') {
    const h = hoursOf(game)
    if (h) parts.push(`${h} played`)
  } else {
    const h = hoursOf(game)
    parts.push(last ? `last played ${formatDay(last)}` : h ? `${h} played` : 'no recorded play')
  }
  return parts.join(' · ')
}

/** One button per game; a tap opens that game's details. */
export function TgAnalyticsDrillList({ kind, games, onPick }: {
  kind: TgaTile
  games: TgGame[]
  onPick: (id: string) => void
}) {
  return (
    <ol className="flex flex-col">
      {games.map((game, i) => (
        <li key={game.id}>
          <button
            type="button"
            onClick={() => onPick(game.id)}
            className="grid min-h-[52px] w-full grid-cols-[1.4rem_30px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[10px] px-2 py-1.5 text-left transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]"
          >
            <span className="text-right text-[11.5px] font-semibold tabular-nums text-[var(--tg-faint)]">{i + 1}</span>
            <span className={`${FRAME} h-10 w-[30px] rounded-[4px]`}>
              <TgCover game={game} mode="contain" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-[var(--tg-text)]">{game.title}</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tg-muted)]">{detail(kind, game)}</span>
            </span>
            <Figure kind={kind} game={game} />
          </button>
        </li>
      ))}
    </ol>
  )
}
