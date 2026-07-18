import { useState } from 'react'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeHeartRateDailySeries, computeHeartRateHourlySeries, computeDailySeries } from '../../healthAggregate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { PeriodToggle, type Period } from './PeriodToggle'
import { BarLineChart } from './BarLineChart'
import { DateNav } from './DateNav'
import { rangeForAnchor, stepAnchor, labelForAnchor } from './dateNav'
import { useAnchorDate } from './useAnchorDate'
import { MetricMiniGrid } from './MetricMiniGrid'
import { HEART_EXTRA_METRICS } from './miniMetrics'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export function HeartSection() {
  const today = todayStr()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useAnchorDate()

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
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            ❤️ Heart Rate {isDay
              ? (anchor === today ? 'Today' : `· ${labelForAnchor('day', anchor)}`)
              : period === 'week' ? '· Weekly Average' : '· Monthly Average'}
          </p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…'
              : isDay ? (dayRange ? `${Math.round(dayRange.min)}–${Math.round(dayRange.max)}` : '—')
              : (avgBpm != null ? Math.round(avgBpm) : '—')}
            <span className="text-sm font-normal text-ink-400"> bpm{!isDay && avgBpm != null ? ' avg' : ''}</span>
          </p>
        </div>
        <div className="flex gap-4 text-center">
          {!isDay && spanMin != null && spanMax != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(spanMin)}–{Math.round(spanMax)}</p>
              <p className="text-[10px] text-ink-400">range</p>
            </div>
          )}
          {resting != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(resting)}</p>
              <p className="text-[10px] text-ink-400">{isDay ? 'resting' : 'avg resting'}</p>
            </div>
          )}
          {hrv != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(hrv)}</p>
              <p className="text-[10px] text-ink-400">{isDay ? 'HRV ms' : 'avg HRV'}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateNav
          label={labelForAnchor(period, anchor)}
          onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
          canGoNext={anchor !== today}
          value={anchor}
          onPick={setAnchor}
        />
        <PeriodToggle value={period} onChange={p => { setPeriod(p); setAnchor(today) }} />
      </div>

      <BarLineChart
        data={chartData}
        dataKey="avg"
        color="#e11d48"
        unit="bpm"
        tooltipLabel="Avg heart rate"
        height={160}
        xInterval={period === 'day' ? 3 : period === 'month' ? 3 : 0}
        onPointClick={period !== 'day' ? (point) => {
          const date = point.date
          if (typeof date === 'string') { setPeriod('day'); setAnchor(date) }
        } : undefined}
      />

      <MetricMiniGrid title="Cardio Extras" metrics={HEART_EXTRA_METRICS} />
    </div>
  )
}
