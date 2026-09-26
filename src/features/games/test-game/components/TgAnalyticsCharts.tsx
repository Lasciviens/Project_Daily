import { CircleCheckBig, Star } from 'lucide-react'
import { formatStars } from '../testGameModel'
import type { TgaWindow } from './tgAnalyticsModel'
import type { TgaColumn, TgaCompletions } from './tgAnalyticsSeries'
import { TGA_RANGE, fmtInt, plural } from './tgAnalyticsFormat'
import { TgAnalyticsColumns } from './TgAnalyticsColumns'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

/** Finish dates per month (per day for 30 days). Older and undated completions are counted, not dropped. */
export function TgAnalyticsCompletions({ series, period, className = '' }: { series: TgaCompletions; period: TgaWindow; className?: string }) {
  const { columns, total, earlier, undated, future, unit } = series
  const notes = [
    earlier ? `${plural(earlier, 'completion')} before this chart starts` : null,
    period === 'all' && undated ? `${plural(undated, 'completed game')} with no finish date` : null,
    future ? `${plural(future, 'finish date')} in the future` : null,
  ].filter(Boolean)

  return (
    <TgAnalyticsCard label="Completions over time" meta={`${fmtInt(total)} ${TGA_RANGE[period]}`} className={className}>
      {total ? (
        <TgAnalyticsColumns
          columns={columns} height={210} noun={{ one: 'completion', many: 'completions' }}
          caption={`Completions per ${unit} ${TGA_RANGE[period]}`}
        />
      ) : (
        <TgAnalyticsEmpty
          icon={CircleCheckBig} className="min-h-[210px]"
          title={`No completions ${TGA_RANGE[period]}`}
          hint="Mark a game Completed and its finish date lands on this timeline."
        />
      )}
      {notes.length > 0 && <p className="mt-3 text-[11.5px] text-[var(--tg-muted)]">Not shown: {notes.join(' · ')}.</p>}
    </TgAnalyticsCard>
  )
}

/** How your personal ratings spread, in half-star steps. */
export function TgAnalyticsRatings({ columns, rated, median, className = '' }: {
  columns: TgaColumn[]; rated: number; median: number | null; className?: string
}) {
  return (
    <TgAnalyticsCard
      label="Rating distribution" className={className}
      meta={rated ? `${plural(rated, 'rated game')} · median ${formatStars(median)}` : undefined}
    >
      {rated ? (
        <TgAnalyticsColumns
          columns={columns} height={180} allTicks noun={{ one: 'game', many: 'games' }}
          caption="Games per personal rating, in half-star steps"
        />
      ) : (
        <TgAnalyticsEmpty icon={Star} className="min-h-[180px]" title="No ratings yet" hint="Rate a game with the stars in its detail panel." />
      )}
    </TgAnalyticsCard>
  )
}
