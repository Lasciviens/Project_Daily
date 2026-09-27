import { useState } from 'react'
import type { BodyCompositionReport } from '../api/bodyCompositionApi'
import { BODY_COMP_FIELDS, average, computeTrend, dailySeries, type BodyCompFieldKey, type BodyCompFieldMeta } from '../bodyCompositionAggregate'
import { scaleChartDomain } from '../bodyweight'
import { fillDays } from '../healthWindowStats'
import { useChartColors } from '../../../shared/ui'
import { localDayOf } from '../../../shared/utils/dateUtils'
import { HealthTrendChart, type TrendPoint } from './HealthTrendChart'
import { fmtDayMonth } from './healthFormat'

const TREND_ARROW: Record<'up' | 'down' | 'flat', string> = { up: '↗', down: '↘', flat: '→' }
const dayOf = (iso: string) => localDayOf(iso) ?? iso.slice(0, 10)

// One featured chart with a metric picker, rather than 14 permanent small
// multiples — this table has enough fields that showing all of them as
// full-size charts at once would be the "wall of charts" this app's own
// Training Progress redesign explicitly moved away from (see CLAUDE.md's
// Progress-tab small-multiples/indexed-chart notes). Every metric here is
// single-series (no legend needed) so the picker can reuse one persistent
// colour per field without any simultaneous-identity concern. Drawn like the
// Body window's scale charts: a plain line on a real date axis, no dots.
export function BodyCompTrendChart({ reportsInWindow, fields = BODY_COMP_FIELDS }: {
  reportsInWindow: BodyCompositionReport[]
  fields?: BodyCompFieldMeta[]
}) {
  const [metric, setMetric] = useState<BodyCompFieldKey>(fields[0].key)
  const meta = fields.find(f => f.key === metric) ?? fields[0]
  const c = useChartColors()

  const points = dailySeries(reportsInWindow, meta.key, dayOf)
  const round = (v: number) => Math.round(v * 10 ** meta.decimals) / 10 ** meta.decimals
  const chartData: TrendPoint[] = points.length
    ? fillDays(points, points[0].date, points[points.length - 1].date)
        .map(d => ({ label: fmtDayMonth(d.date), date: d.date, value: d.value == null ? null : round(d.value) }))
    : []
  const avg = average(reportsInWindow, meta.key)
  const trend = computeTrend(reportsInWindow, meta.key)
  // Scan-to-scan noise must not fill the chart: at least 2 units (4 for whole-
  // number fields), or 4 % of the level for big numbers such as BMR.
  const yDomain = scaleChartDomain(points.map(p => p.value), Math.max(meta.decimals ? 2 : 4, Math.abs(avg ?? 0) * 0.04))

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Metric" className="scroll-x -mx-1 flex gap-1 px-1 sm:flex-wrap">
        {fields.map(f => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={metric === f.key}
            onClick={() => setMetric(f.key)}
            className="pill-tab shrink-0 px-3 text-meta"
          >
            {f.label}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="py-6 text-center text-body text-fg-muted">No data for this metric in the selected period.</p>
      ) : (
        <>
          <HealthTrendChart data={chartData} unit={meta.unit} ariaLabel={`${meta.label} from the scale reports`} height={180}
            formatValue={v => v.toFixed(meta.decimals)} yDomain={yDomain}
            series={[points.length >= 2
              ? { key: 'value', label: meta.label.toLowerCase(), color: c.series[meta.series], kind: 'line', plain: true, connectNulls: true }
              : { key: 'value', label: meta.label.toLowerCase(), color: c.series[meta.series], kind: 'line' }]} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-fg-muted">
            {avg != null && (
              <p>Average (period): <span className="font-semibold tabular-nums text-fg">{avg.toFixed(meta.decimals)} {meta.unit}</span></p>
            )}
            {trend && (
              <p>
                Trend: <span className="font-semibold tabular-nums text-fg">
                  {TREND_ARROW[trend.direction]} {trend.direction === 'flat' ? 'flat' : `${trend.perWeek > 0 ? '+' : ''}${trend.perWeek.toFixed(meta.decimals)} ${meta.unit}/week`}
                </span>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
