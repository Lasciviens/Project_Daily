import { InfoBubble } from '../../../../shared/components/InfoBubble'
import type { TrendStats } from '../../healthTrendStats'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { weekRangeLabel } from '../../healthDateLabels'

// The trend numbers for one metric: 7/30/90-day change, weekly rate, best and
// worst complete week, and whether it has become steadier. Every figure comes
// from healthTrendStats.buildTrendStats (pure, verified).

interface Props {
  stats: TrendStats
  /** A level: "8,120", "7h 05m". */
  format: (v: number) => string
  /** A change: "+320", "−0.4 kg". */
  formatDelta: (v: number) => string
  /** "per day" / "per night" — what each window mean is. */
  per?: string
  /** 'up' / 'down' = which way is better (names best/worst); null = a range is best. */
  direction: 'up' | 'down' | null
  /** Label of the weekly rate ("kg/week"); omit to hide the rate. */
  rateUnit?: string
  className?: string
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-row bg-surface-2 px-2.5 py-2">
      <p className="text-micro font-medium text-fg-muted">{label}</p>
      <p className="text-body font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="truncate text-micro font-normal text-fg-faint">{sub}</p>}
    </div>
  )
}

export function TrendStatsBlock({ stats, format, formatDelta, per, direction, rateUnit, className }: Props) {
  // The Monday–Sunday range, not just its Monday ("7–13 Jul").
  const weekLabel = (w: { weekStart: string }) => weekRangeLabel(w.weekStart, todayStr())
  const v = stats.variability
  const hasAny = stats.changes.some(c => c.delta != null) || stats.best || stats.rate || v.verdict
  if (!hasAny) return <p className={`text-meta text-fg-muted ${className ?? ''}`}>Not enough history yet for trend statistics.</p>
  return (
    <div className={className}>
      <p className="section-label mb-1.5 flex items-center gap-1">
        Trend
        <InfoBubble label="About these trend numbers">
          Each change compares the average {per ?? 'per day'} of the last 7, 30 or 90 days with the same number of days just
          before. Best and worst weeks are complete Monday–Sunday weeks in the last 90 days. Steadiness compares the day-to-day
          spread (standard deviation) of the last 30 days with the 30 before; a change under 15% counts as similar.
        </InfoBubble>
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {stats.changes.map(c => (
          <Cell key={c.days} label={`${c.days}-day change`}
            value={c.delta != null ? formatDelta(c.delta) : '—'}
            sub={c.current != null ? `now ${format(c.current)}` : 'too few readings'} />
        ))}
        {rateUnit && stats.rate && (
          <Cell label="Weekly rate" value={`${formatDelta(stats.rate.perWeek)}`} sub={`${rateUnit}, last ${stats.rate.days} days`} />
        )}
        {stats.best && stats.worst && (
          <>
            <Cell label={direction ? 'Best week' : 'Highest week'} value={format(stats.best.value)} sub={weekLabel(stats.best)} />
            <Cell label={direction ? 'Worst week' : 'Lowest week'} value={format(stats.worst.value)} sub={weekLabel(stats.worst)} />
          </>
        )}
        {v.verdict && v.sd != null && v.previousSd != null && (
          <Cell label="Day-to-day spread" value={v.verdict === 'similar' ? 'Similar' : v.verdict === 'steadier' ? 'Steadier' : 'More variable'}
            sub={`±${format(v.sd)} vs ±${format(v.previousSd)}`} />
        )}
      </div>
    </div>
  )
}
