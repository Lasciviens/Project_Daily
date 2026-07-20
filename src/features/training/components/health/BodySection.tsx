import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'
import { BarLineChart } from './BarLineChart'
import { MetricMiniGrid } from './MetricMiniGrid'
import { BODY_EXTRA_METRICS } from './miniMetrics'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

interface MiniChartProps {
  title: string
  icon: string
  unit: string
  color: string
  series: { date: string; value: number }[]
  decimals?: number
}

function BodyMiniChart({ title, icon, unit, color, series, decimals = 1 }: MiniChartProps) {
  const chartData = series.map(d => ({ label: fmtDay(d.date), value: Math.round(d.value * 10 ** decimals) / 10 ** decimals }))
  const latest = series[series.length - 1]?.value

  return (
    <div className="flex-1 min-w-[220px] flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{icon} {title}</p>
        <p className="text-sm font-bold text-ink-900">
          {latest != null ? latest.toFixed(decimals) : '—'} <span className="text-[10px] font-normal text-ink-400">{unit}</span>
        </p>
      </div>
      {chartData.length === 0 ? (
        <p className="text-xs text-ink-300 py-6 text-center">No data yet.</p>
      ) : (
        <BarLineChart data={chartData} dataKey="value" color={color} unit={unit} tooltipLabel={title} />
      )}
    </div>
  )
}

export function BodySection() {
  // Weight/body composition metrics are sparse, event-based (only update when
  // you step on the scale) — a wide window so charts aren't mostly empty.
  const from = daysAgoStr(89)
  const to = todayStr()
  const { data: weightPoints = [] } = useHealthMetricSeries('weight_body_mass', from, to)
  const { data: fatPoints = [] } = useHealthMetricSeries('body_fat_percentage', from, to)
  const { data: bmiPoints = [] } = useHealthMetricSeries('body_mass_index', from, to)

  const weight = computeDailySeries('weight_body_mass', weightPoints)
  const fat = computeDailySeries('body_fat_percentage', fatPoints)
  const bmi = computeDailySeries('body_mass_index', bmiPoints)

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">⚖️ Body (last 90 days)</p>
      <div className="flex flex-wrap gap-5">
        <BodyMiniChart title="Weight" icon="⚖️" unit="kg" color="#7c3aed" series={weight} decimals={1} />
        <BodyMiniChart title="Body Fat" icon="📏" unit="%" color="#f59e0b" series={fat} decimals={1} />
        <BodyMiniChart title="BMI" icon="📐" unit="" color="#0ea5e9" series={bmi} decimals={1} />
      </div>

      <MetricMiniGrid title="Lifestyle & Environment" metrics={BODY_EXTRA_METRICS} />
    </div>
  )
}
