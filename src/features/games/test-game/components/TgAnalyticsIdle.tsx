import { formatDay, platformInfo } from '../testGameModel'
import type { TgaPlayingBreakdown } from './tgAnalyticsMore'
import { fmtInt, plural } from './tgAnalyticsFormat'
import { idleLabel, idleSplit } from './tgAnalyticsDrillCopy'
import { openGameFromAnalytics } from './tgAnalyticsOpen'
import { useAnalyticsHandoff } from './tgAnalyticsHandoff'
import { TgCover } from './TgCover'
import { TgAnalyticsCard } from './TgAnalyticsCard'

const SHOWN = 6

const PRESS = 'rounded-[10px] text-left transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]'
const FRAME = 'relative overflow-hidden bg-[var(--tg-panel-2)] ring-1 ring-[var(--tg-border)] shadow-[shadow:var(--tg-cover-shadow)]'

/**
 * Games marked Playing that haven't had a session in 60 days, longest idle
 * first. An importer promotes a game with real hours to Playing but never
 * demotes it, so this is where "Playing" quietly stops being true. Always the
 * whole library: an idle game has no session inside a shorter window. Absent
 * when nothing is idle.
 */
export function TgAnalyticsIdle({ breakdown, windowed, className = '' }: {
  breakdown: TgaPlayingBreakdown
  windowed: boolean
  className?: string
}) {
  const handoff = useAnalyticsHandoff()
  const { stale } = breakdown
  if (stale.length === 0) return null
  const more = stale.length - SHOWN

  return (
    <TgAnalyticsCard label="Playing, but idle" meta={`${fmtInt(breakdown.total)} playing`} className={className}>
      {/* The split is too long for the header's one truncating line. */}
      <p className="-mt-1 mb-3 text-[12px] text-[var(--tg-muted)]">
        {idleSplit(breakdown)}{windowed && ' · across the whole library, not only this window'}
      </p>
      <ul className="flex flex-col">
        {stale.slice(0, SHOWN).map(({ game, last, idleDays }) => (
          <li key={game.id}>
            <button
              type="button"
              onClick={() => openGameFromAnalytics(game.id)}
              aria-label={`${game.title}, ${idleLabel(idleDays)}. Open details`}
              className={`${PRESS} -mx-2 grid min-h-[52px] w-[calc(100%+1rem)] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-1`}
            >
              <span className={`${FRAME} h-11 w-8 rounded-[5px]`}>
                <TgCover game={game} mode="contain" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-[var(--tg-text)]">{game.title}</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tg-muted)]">
                  {platformInfo(game.platformKey).short}
                  {last ? <> · last played {formatDay(last)}</> : <> · no session recorded</>}
                </span>
              </span>
              <span className="whitespace-nowrap text-right text-[12.5px] font-semibold tabular-nums text-[var(--tg-text-2)]">
                {idleDays == null ? '—' : idleLabel(idleDays)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--tg-border)] pt-3">
          <span className="text-[12px] text-[var(--tg-muted)]">{plural(more, 'more idle game')}</span>
          <button
            type="button"
            onClick={() => handoff.open('Playing, idle 60+ days', stale.map(x => x.game), { status: 'playing', wholeLibrary: true })}
            aria-label={`Show all ${fmtInt(stale.length)} idle Playing games in the library`}
            className="tg-btn tg-btn-secondary min-h-[36px] px-3 text-[12.5px] [@media(pointer:coarse)]:min-h-[44px]"
          >
            Show all {fmtInt(stale.length)} idle
          </button>
        </div>
      )}
    </TgAnalyticsCard>
  )
}
