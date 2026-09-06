import { useState } from 'react'
import type { BodyCompositionReport } from '../../api/bodyCompositionApi'
import { BODY_COMP_FIELDS, average, computeTrend, type BodyCompFieldKey } from '../../bodyCompositionAggregate'
import { BarLineChart } from './BarLineChart'

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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

  const points = reportsInWindow.filter(r => Number.isFinite(r[metric]))
  const chartData = points.map(r => ({ label: fmtDay(r.measured_at), value: Math.round(r[metric] * 10 ** meta.decimals) / 10 ** meta.decimals }))
  const avg = average(reportsInWindow, metric)
  const trend = computeTrend(reportsInWindow, metric)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {BODY_COMP_FIELDS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setMetric(f.key)}
            className={`min-h-[32px] px-2.5 rounded-full text-[11px] font-semibold border transition-colors ${
              metric === f.key ? 'text-white border-transparent' : 'text-ink-500 border-ink-200 hover:border-ink-300'
            }`}
            style={metric === f.key ? { backgroundColor: f.color } : undefined}
          >
            {f.icon} {f.label}
          </button>
        ))}
      </div>

      {chartData.length === 0 ? (
        <p className="text-xs text-ink-300 py-6 text-center">No data for this metric in the selected period.</p>
      ) : (
        <>
          <BarLineChart data={chartData} dataKey="value" color={meta.color} unit={meta.unit} tooltipLabel={meta.label} height={180} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-500">
            {avg != null && (
              <p>Average (period): <span className="font-semibold text-ink-800">{avg.toFixed(meta.decimals)} {meta.unit}</span></p>
            )}
            {trend && (
              <p>
                Trend: <span className="font-semibold text-ink-800">
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
