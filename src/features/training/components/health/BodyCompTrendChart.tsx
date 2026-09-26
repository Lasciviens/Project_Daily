import { useState } from 'react'
import type { BodyCompositionReport } from '../../api/bodyCompositionApi'
import { BODY_COMP_FIELDS, average, computeTrend, type BodyCompFieldKey } from '../../bodyCompositionAggregate'
import { BarLineChart } from './BarLineChart'
import { useChartColors } from '../../../../shared/ui'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'

function fmtDay(iso: string): string {
  return fmtDateEnGB(new Date(iso), { day: 'numeric', month: 'short' })
}

const TREND_ARROW: Record<'up' | 'down' | 'flat', string> = { up: '↗', down: '↘', flat: '→' }

// One featured chart with a metric picker, rather than 14 permanent small
// multiples — this table has enough fields that showing all of them as
// full-size charts at once would be the "wall of charts" this app's own
// Training Progress redesign explicitly moved away from (see CLAUDE.md's
// Progress-tab small-multiples/indexed-chart notes). Every metric here is
// single-series (no legend needed) so the picker can reuse one persistent
// colour per field without any simultaneous-identity concern.
export function BodyCompTrendChart({ reportsInWindow }: { reportsInWindow: BodyCompositionReport[] }) {
  const [metric, setMetric] = useState<BodyCompFieldKey>('weight_kg')
  const meta = BODY_COMP_FIELDS.find(f => f.key === metric)!
  const c = useChartColors()

  const points = reportsInWindow.filter(r => Number.isFinite(r[metric]))
  const chartData = points.map(r => ({ label: fmtDay(r.measured_at), value: Math.round(r[metric] * 10 ** meta.decimals) / 10 ** meta.decimals }))
  const avg = average(reportsInWindow, metric)
  const trend = computeTrend(reportsInWindow, metric)

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Metric" className="scroll-x -mx-1 flex gap-1 px-1 sm:flex-wrap">
        {BODY_COMP_FIELDS.map(f => (
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

      {chartData.length === 0 ? (
        <p className="py-6 text-center text-body text-fg-muted">No data for this metric in the selected period.</p>
      ) : (
        <>
          <BarLineChart data={chartData} dataKey="value" color={c.series[meta.series]} unit={meta.unit} tooltipLabel={meta.label} height={180} />
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
