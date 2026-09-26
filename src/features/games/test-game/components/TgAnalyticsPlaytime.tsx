import { Hourglass } from 'lucide-react'
import type { concentration, TgaPlaytimeBucket } from './tgAnalyticsMore'
import { fmtHours } from './tgAnalyticsData'
import { TGA_ROW_H } from './tgAnalyticsFormat'
import { TGA_LIB_META, concentrationSentence, libsPresent } from './tgAnalyticsPlay'
import { libraryOf } from './tgAnalyticsModel'
import { openGameFromAnalytics } from './tgAnalyticsOpen'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgAnalyticsPlaytimeBars } from './TgAnalyticsPlaytimeBars'

const PRESS = 'transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]'

/**
 * Where the hours go: how much of all play time the top few games hold (each
 * opens its details), then every game with play time bucketed by how much.
 * Lifetime totals — the providers report nothing per session.
 */
export function TgAnalyticsPlaytime({ buckets, concentration: c, className = '' }: {
  buckets: TgaPlaytimeBucket[]
  concentration: ReturnType<typeof concentration>
  className?: string
}) {
  const sentence = concentrationSentence(c, fmtHours)
  const withTime = buckets.reduce((n, b) => n + b.count, 0)
  return (
    <TgAnalyticsCard label="How your play time spreads" meta={withTime ? 'lifetime totals' : undefined} className={className}>
      {sentence ? (
        <div className="grid gap-6 @[40rem]:grid-cols-2 @[40rem]:gap-8">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium leading-snug text-[var(--tg-text)]">{sentence}</p>
            <ol className="-mx-2 mt-3 flex flex-col">
              {c.top.map(({ game, seconds }, i) => {
                const lib = TGA_LIB_META[libraryOf(game)]
                return (
                  <li key={game.id}>
                    <button
                      type="button" onClick={() => openGameFromAnalytics(game.id)}
                      aria-label={`${game.title} (${lib.label}), ${fmtHours(seconds)}. Open details`}
                      className={`grid w-full grid-cols-[1rem_10px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[10px] px-2 text-left ${TGA_ROW_H} ${PRESS}`}
                    >
                      <span className="text-right text-[12px] font-semibold tabular-nums text-[var(--tg-muted)]">{i + 1}</span>
                      <span aria-hidden title={lib.label} className="h-2.5 w-2.5 rounded-full" style={{ background: lib.color }} />
                      <span className="truncate text-[13px] font-medium text-[var(--tg-text)]">{game.title}</span>
                      <span className="whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-[var(--tg-text)]">{fmtHours(seconds)}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
          <TgAnalyticsPlaytimeBars buckets={buckets} libs={libsPresent(buckets)} total={withTime} />
        </div>
      ) : (
        <TgAnalyticsEmpty icon={Hourglass} title="No play time recorded" hint="ES-DE, Steam and PlayStation report lifetime hours after their next sync — then this shows where they go." />
      )}
    </TgAnalyticsCard>
  )
}
