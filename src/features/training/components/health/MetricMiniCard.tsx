import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries } from '../../healthAggregate'
import { getAggregationType } from '../../healthMetrics'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'

export interface MiniMetricConfig {
  metric: string
  icon: string
  title: string
  unit: string
  decimals: number
  description: string
  // Shows how many raw events were logged today alongside the main value —
  // for metrics where "how many times" matters as much as the total/average
  // (e.g. handwashing, toothbrushing).
  showTodayCount?: boolean
  // Lists the time-of-day of each occurrence today (e.g. "08:44, 23:03") —
  // for metrics where WHEN it happened is useful, not just how much/often.
  showTodayTimes?: boolean
}

// sum metrics read as "today's total" (matches Steps/Energy's headline
// numbers); average/latest metrics are noisier day-to-day so a 7-day window
// gives a steadier, more meaningful read.
function summarize(metric: string, series: { date: string; value: number }[]) {
  const aggType = getAggregationType(metric)
  if (aggType === 'sum') {
    const today = series.find(d => d.date === todayStr())
    return { value: today?.value ?? null, windowLabel: 'Today' }
  }
  if (aggType === 'latest') {
    const last = series[series.length - 1]
    return { value: last?.value ?? null, windowLabel: 'Latest' }
  }
  const vals = series.map(d => d.value)
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  return { value: avg, windowLabel: '7-day avg' }
}

export function MetricMiniCard({ config }: { config: MiniMetricConfig }) {
  const { metric, icon, title, unit, decimals, description, showTodayCount, showTodayTimes } = config
  const { data: points = [] } = useHealthMetricSeries(metric, daysAgoStr(6), todayStr())
  const series = computeDailySeries(metric, points)
  const { value, windowLabel } = summarize(metric, series)
  const displayUnit = points.find(p => p.unit)?.unit || unit
  const todayPoints = (showTodayCount || showTodayTimes) ? points.filter(p => p.date === todayStr()) : []
  const todayCount = showTodayCount ? todayPoints.length : null
  const todayTimes = showTodayTimes
    ? todayPoints
        .map(p => new Date(p.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
        .sort()
    : null

  return (
    <div className="bg-cream-50 border border-ink-100 rounded-xl p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1">
        <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink-400 leading-tight">{icon} {title}</p>
        <span className="text-[10.5px] text-ink-300 shrink-0">{windowLabel}</span>
      </div>
      <p className="text-[19.5px] font-bold text-ink-900 leading-tight">
        {value != null ? value.toFixed(decimals) : '—'}
        <span className="text-[11.5px] font-normal text-ink-400 ml-1">{displayUnit}</span>
      </p>
      {todayCount != null && (
        <p className="text-[11.5px] font-semibold text-accent-600">{todayCount}× today</p>
      )}
      {todayTimes && todayTimes.length > 0 && (
        <p className="text-[11.5px] font-semibold text-accent-600">{todayTimes.join(', ')}</p>
      )}
      <p className="text-[11.5px] text-ink-400 leading-snug">{description}</p>
    </div>
  )
}
