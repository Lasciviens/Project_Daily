import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { RATE_MIN_DAYS, type TrendStats } from '../../healthTrendStats'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { weekRangeLabel } from '../../healthDateLabels'

// The trend numbers for one metric over the period picked in the range bar:
// its change against the same number of days just before, the weekly rate,
// the best and worst complete week inside it, and whether it has become
// steadier. Every figure comes from healthTrendStats.buildTrendStats (pure,
// verified); the labels carry no period length — the range bar names it.

interface Props {
  stats: TrendStats
  /** A level: "8,120", "7h 05m". */
  format: (v: number) => string
  /** A change: "+320", "−0.4 kg". */
  formatDelta: (v: number) => string
  /** "per day" / "per night" — what each period mean is. */
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
      {sub && <p className="text-micro font-normal leading-snug text-fg-faint">{sub}</p>}
    </div>
  )
}

export function TrendStatsBlock({ stats, format, formatDelta, per, direction, rateUnit, className }: Props) {
  // The Monday–Sunday range, not just its Monday ("07.07.2026 – 13.07.2026").
  const weekLabel = (w: { weekStart: string }) => weekRangeLabel(w.weekStart, todayStr())
  const { change: c, variability: v } = stats
  const hasAny = c.current != null || stats.best || stats.rate || v.verdict
  if (!hasAny) return <p className={`text-meta text-fg-muted ${className ?? ''}`}>Too few readings in this period for trend numbers.</p>
  return (
    <div className={className}>
      <p className="section-label mb-1.5 flex items-center gap-1">
        Trend
        <InfoBubble label="About these trend numbers">
          The change compares the average {per ?? 'per day'} of the period picked above with the same number of days just
          before it. The weekly rate is a straight line through the period&apos;s readings ({RATE_MIN_DAYS} days or longer).
          Best and worst weeks are complete Monday–Sunday weeks inside the period. Day-to-day spread compares the standard
          deviation of the period with the one before; a change under 15% counts as similar.
        </InfoBubble>
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Cell label="Change"
          value={c.delta != null ? formatDelta(c.delta) : '—'}
          sub={c.current == null ? 'too few readings' : c.previous != null ? `${format(c.current)} vs ${format(c.previous)}` : `${format(c.current)} · none before`} />
        {rateUnit && stats.rate && (
          <Cell label="Weekly rate" value={`${formatDelta(stats.rate.perWeek)}`} sub={rateUnit} />
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
