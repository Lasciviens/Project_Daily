import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeHeartRateDailySeries, computeHeartRateHourlySeries, computeDailySeries } from '../../healthAggregate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { HealthRange } from './sectionTypes'
import { BarLineChart } from './BarLineChart'
import { rangeForAnchor, labelForAnchor } from './dateNav'
import { MetricMiniGrid } from './MetricMiniGrid'
import { HEART_EXTRA_METRICS } from './miniMetrics'
import { useChartColors } from '../../../../shared/ui'
import { HeadlineStat, SectionCard, SideStat } from './sectionKit'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export function HeartSection({ range }: { range: HealthRange }) {
  const today = todayStr()
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()

  // The mini-metric cards read the SAME window the rest of the page is on
  // (they used to be pinned to the last 7 days ending today, so they sat
  // frozen while this control moved).
  const miniWindow = { ...rangeForAnchor(period, anchor), period }

  // Headline follows the SELECTED PERIOD: Day → that day's min–max + resting
  // + HRV; Week/Month → period averages of the daily values, from the same
  // range the chart shows (in Day mode from==to==anchor, so nothing extra
  // is fetched vs the old anchor-only queries).
  const isDay = period === 'day'
  const { from, to } = rangeForAnchor(period, anchor)
  const { data: rangePoints = [], isLoading } = useHealthMetricSeries('heart_rate', from, to)
  const { data: restingPoints = [] } = useHealthMetricSeries('resting_heart_rate', from, to)
  const { data: hrvPoints = [] } = useHealthMetricSeries('heart_rate_variability', from, to)

  const hrDaily = computeHeartRateDailySeries(rangePoints)
  const restingDaily = computeDailySeries('resting_heart_rate', restingPoints)
  const hrvDaily = computeDailySeries('heart_rate_variability', hrvPoints)

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  const dayRange = isDay ? hrDaily[0] : undefined
  const avgBpm = !isDay ? mean(hrDaily.map(d => d.avg)) : null
  const spanMin = !isDay && hrDaily.length ? Math.min(...hrDaily.map(d => d.min)) : null
  const spanMax = !isDay && hrDaily.length ? Math.max(...hrDaily.map(d => d.max)) : null
  const resting = isDay ? restingDaily[0]?.value : mean(restingDaily.map(d => d.value))
  const hrv = isDay ? hrvDaily[0]?.value : mean(hrvDaily.map(d => d.value))

  const chartData = isDay
    ? computeHeartRateHourlySeries(rangePoints).map(r => ({ label: r.label, avg: Math.round(r.avg) }))
    : hrDaily.map(r => ({ label: fmtDay(r.date), date: r.date, avg: Math.round(r.avg) }))

  return (
    <SectionCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={<>Heart rate {isDay
            ? (anchor === today ? 'today' : `· ${labelForAnchor('day', anchor)}`)
            : period === 'week' ? '· weekly average' : '· monthly average'}</>}
          value={isLoading ? '…'
            : isDay ? (dayRange ? `${Math.round(dayRange.min)}–${Math.round(dayRange.max)}` : '—')
            : (avgBpm != null ? Math.round(avgBpm) : '—')}
          unit={`bpm${!isDay && avgBpm != null ? ' avg' : ''}`}
        />
        <div className="flex gap-4">
          {!isDay && spanMin != null && spanMax != null && <SideStat value={`${Math.round(spanMin)}–${Math.round(spanMax)}`} label="range" />}
          {resting != null && <SideStat value={Math.round(resting)} label={isDay ? 'resting' : 'avg resting'} />}
          {hrv != null && <SideStat value={Math.round(hrv)} label={isDay ? 'HRV ms' : 'avg HRV'} />}
        </div>
      </div>

      <BarLineChart
        data={chartData}
        dataKey="avg"
        color={c.series[3]}
        unit="bpm"
        tooltipLabel="Avg heart rate"
        height={160}
        xInterval={period === 'day' ? 3 : period === 'month' ? 3 : 0}
        onPointClick={period !== 'day' ? (point) => {
          const date = point.date
          if (typeof date === 'string') { setPeriod('day'); setAnchor(date) }
        } : undefined}
      />

      <MetricMiniGrid title="Cardio extras" metrics={HEART_EXTRA_METRICS} window={miniWindow} />
    </SectionCard>
  )
}
