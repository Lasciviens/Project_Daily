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

  // Headline follows the anchor (whichever day is selected), not always the
  // literal calendar today.
  const { data: todayHr = [], isLoading } = useHealthMetricSeries('heart_rate', anchor, anchor)
  const { data: todayResting = [] } = useHealthMetricSeries('resting_heart_rate', anchor, anchor)
  const { data: todayHrv = [] } = useHealthMetricSeries('heart_rate_variability', anchor, anchor)
  const todayRange = computeHeartRateDailySeries(todayHr)[0]
  const restingToday = computeDailySeries('resting_heart_rate', todayResting)[0]?.value
  const hrvToday = computeDailySeries('heart_rate_variability', todayHrv)[0]?.value

  const { from, to } = rangeForAnchor(period, anchor)
  const { data: rangePoints = [] } = useHealthMetricSeries('heart_rate', from, to)
  const chartData = period === 'day'
    ? computeHeartRateHourlySeries(rangePoints).map(r => ({ label: r.label, avg: Math.round(r.avg) }))
    : computeHeartRateDailySeries(rangePoints).map(r => ({ label: fmtDay(r.date), date: r.date, avg: Math.round(r.avg) }))

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            ❤️ Heart Rate {anchor === today ? 'Today' : `· ${labelForAnchor('day', anchor)}`}
          </p>
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
