import { useState } from 'react'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeHeartRateDailySeries, computeHeartRateHourlySeries, computeDailySeries } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'
import { PeriodToggle, type Period } from './PeriodToggle'
import { BarLineChart } from './BarLineChart'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

function rangeFor(period: Period): { from: string; to: string } {
  const to = todayStr()
  if (period === 'day') return { from: to, to }
  if (period === 'week') return { from: daysAgoStr(6), to }
  return { from: daysAgoStr(29), to }
}

export function HeartSection() {
  const today = todayStr()
  const [period, setPeriod] = useState<Period>('week')

  const { data: todayHr = [], isLoading } = useHealthMetricSeries('heart_rate', today, today)
  const { data: todayResting = [] } = useHealthMetricSeries('resting_heart_rate', today, today)
  const { data: todayHrv = [] } = useHealthMetricSeries('heart_rate_variability', today, today)
  const todayRange = computeHeartRateDailySeries(todayHr)[0]
  const restingToday = computeDailySeries('resting_heart_rate', todayResting)[0]?.value
  const hrvToday = computeDailySeries('heart_rate_variability', todayHrv)[0]?.value

  const { from, to } = rangeFor(period)
  const { data: rangePoints = [] } = useHealthMetricSeries('heart_rate', from, to)
  const chartData = period === 'day'
    ? computeHeartRateHourlySeries(rangePoints).map(r => ({
        label: r.label, range: [Math.round(r.min), Math.round(r.max)] as [number, number], avg: Math.round(r.avg),
      }))
    : computeHeartRateDailySeries(rangePoints).map(r => ({
        label: fmtDay(r.date), range: [Math.round(r.min), Math.round(r.max)] as [number, number], avg: Math.round(r.avg),
      }))

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">❤️ Heart Rate Today</p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {isLoading ? '…' : todayRange ? `${Math.round(todayRange.min)}–${Math.round(todayRange.max)}` : '—'}
            <span className="text-sm font-normal text-ink-400"> bpm</span>
          </p>
        </div>
        <div className="flex gap-4 text-center">
          {restingToday != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(restingToday)}</p>
              <p className="text-[10px] text-ink-400">resting</p>
            </div>
          )}
          {hrvToday != null && (
            <div>
              <p className="text-lg font-bold text-ink-800">{Math.round(hrvToday)}</p>
              <p className="text-[10px] text-ink-400">HRV ms</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide">
          {period === 'day' ? 'Today by hour' : period === 'week' ? 'Last 7 days' : 'Last 30 days'}
        </p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      <BarLineChart
        data={chartData}
        dataKey="avg"
        rangeKey="range"
        color="#e11d48"
        unit="bpm"
        tooltipLabel="Avg heart rate"
        height={160}
        xInterval={period === 'day' ? 3 : period === 'month' ? 3 : 0}
      />
    </div>
  )
}
