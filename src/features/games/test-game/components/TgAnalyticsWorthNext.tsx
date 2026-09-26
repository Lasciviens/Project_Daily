import { Sparkles } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { fmtScore, worthNextSubline } from './tgAnalyticsCollection'
import { openGameFromAnalytics } from './tgAnalyticsOpen'
import { TgCover } from './TgCover'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

const PRESS = 'rounded-[10px] text-left transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]'
const FRAME = 'relative overflow-hidden bg-[var(--tg-panel-2)] ring-1 ring-[var(--tg-border)] shadow-[shadow:var(--tg-cover-shadow)]'

/**
 * Games with no recorded play that the community rates highest (80 or more),
 * best first. It reads the whole library, not the time window: an unplayed
 * game has no date to fall inside one.
 */
export function TgAnalyticsWorthNext({ items, windowed = false, className = '' }: {
  items: { game: TgGame; score: number }[]
  /** A time window is picked — say that this card ignores it. */
  windowed?: boolean
  className?: string
}) {
  return (
    <TgAnalyticsCard label="Worth playing next" meta={items.length ? 'unplayed · best community score' : undefined} className={className}>
      {items.length ? (
        <>
          <ol className="flex flex-col">
            {items.map(({ game, score }) => (
              <li key={game.id}>
                <button
                  type="button"
                  onClick={() => openGameFromAnalytics(game.id)}
                  aria-label={`${game.title}, community score ${fmtScore(score)} of 100. Open details`}
                  className={`${PRESS} -mx-2 grid min-h-[52px] w-[calc(100%+1rem)] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-1`}
                >
                  <span className={`${FRAME} h-11 w-8 rounded-[5px]`}>
                    <TgCover game={game} mode="contain" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-[var(--tg-text)]">{game.title}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tg-muted)]">{worthNextSubline(game)}</span>
                  </span>
                  <span
                    title="Community score, out of 100"
                    className="inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-full bg-[var(--tg-accent-soft)] px-2 text-[12px] font-semibold tabular-nums text-[var(--tg-accent)]"
                  >
                    {fmtScore(score)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--tg-muted)]">
            No recorded play and a community score of 80 or more; dropped and completed games are left out
            {windowed ? '. Reads the whole library — the time window doesn’t apply here.' : '.'}
          </p>
        </>
      ) : (
        <TgAnalyticsEmpty
          icon={Sparkles} title="Nothing to suggest"
          hint="Nothing unplayed scores 80 or more — or scores haven’t been scraped yet."
        />
      )}
    </TgAnalyticsCard>
  )
}
