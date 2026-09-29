import type { seriesRows } from './tgAnalyticsMore'
import { fmtInt, plural, TGA_TINT } from './tgAnalyticsFormat'
import { seriesLine, seriesShareNote } from './tgAnalyticsCollection'
import { TgAnalyticsCard } from './TgAnalyticsCard'
import { Truncate } from '../../../../shared/ui/Truncate'

/**
 * The biggest series in view and how far through each you are: a slim bar
 * of completed out of owned, the numbers written beside it. Nothing renders
 * when no series has two games.
 */
export function TgAnalyticsSeriesCard({ series, className = '' }: { series: ReturnType<typeof seriesRows>; className?: string }) {
  if (!series.rows.length) return null
  const note = seriesShareNote(series.share)
  return (
    <TgAnalyticsCard label="Series" meta={`${plural(series.withSeries, 'game')} in a series`} className={className}>
      <ul className="grid gap-x-8 gap-y-3 @[40rem]:grid-cols-2">
        {series.rows.map(row => (
          <li key={row.key} className="min-w-0">
            <p className="flex items-baseline justify-between gap-3">
              <Truncate className="text-[13px] font-medium text-[var(--tg-text)]">{row.label}</Truncate>
              <span className="shrink-0 text-[12px] tabular-nums text-[var(--tg-muted)]">{plural(row.games, 'game')}</span>
            </p>
            <Truncate as="p" className="mt-0.5 text-[11.5px] text-[var(--tg-muted)]">{seriesLine(row)}</Truncate>
            <span
              aria-hidden title={`${fmtInt(row.completed)} of ${fmtInt(row.games)} completed`}
              className={`mt-1.5 block h-1.5 overflow-hidden rounded-full ${TGA_TINT}`}
            >
              <span className="block h-full rounded-full bg-[var(--tg-accent)]" style={{ width: `${(row.completed / row.games) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--tg-muted)]">{note}</p>}
    </TgAnalyticsCard>
  )
}
