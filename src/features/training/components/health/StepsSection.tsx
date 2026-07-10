import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHourlyBuckets } from '../../healthAggregate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { PeriodToggle, type Period } from './PeriodToggle'
import { DateNav } from './DateNav'
import { rangeForAnchor, stepAnchor, labelForAnchor } from './dateNav'
import { useAnchorDate } from './useAnchorDate'
import { MetricMiniGrid } from './MetricMiniGrid'
import { STEPS_EXTRA_METRICS } from './miniMetrics'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export function StepsSection() {
  const today = todayStr()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useAnchorDate()

  // Headline follows the anchor (whichever day is selected), not always the
  // literal calendar today — independent of the chart period below.
  const { data: todayStepPoints = [], isLoading: stepsLoading } = useHealthMetricSeries('step_count', anchor, anchor)
  const { data: todayDistPoints = [] } = useHealthMetricSeries('walking_running_distance', anchor, anchor)
  const steps = computeDailySeries('step_count', todayStepPoints)[0]?.value ?? 0
  const distanceKm = computeDailySeries('walking_running_distance', todayDistPoints)[0]?.value ?? 0
  const pace = steps > 0 && distanceKm > 0 ? (distanceKm * 1000) / steps : null

  const { from, to } = rangeForAnchor(period, anchor)
  const { data: rangePoints = [] } = useHealthMetricSeries('step_count', from, to)
  const chartData: { label: string; date?: string; value: number }[] = period === 'day'
    ? computeHourlyBuckets('step_count', rangePoints).map(h => ({ label: h.label, value: Math.round(h.value) }))
    : computeDailySeries('step_count', rangePoints).map(d => ({ label: fmtDay(d.date), date: d.date, value: Math.round(d.value) }))

  function handleBarClick(barData: { payload?: { date?: string } }) {
    const date = barData?.payload?.date
    if (period !== 'day' && date) { setPeriod('day'); setAnchor(date) }
  }

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            🚶 Steps {anchor === today ? 'Today' : `· ${labelForAnchor('day', anchor)}`}
          </p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {stepsLoading ? '…' : steps.toLocaleString('en-GB')}
          </p>
        </div>
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-lg font-bold text-ink-800">{distanceKm.toFixed(2)}</p>
            <p className="text-[10px] text-ink-400">km</p>
          </div>
          {pace != null && (
            <div className="text-center">
              <p className="text-lg font-bold text-ink-800">{Math.round(pace)}</p>
              <p className="text-[10px] text-ink-400">cm/step</p>
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

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={period === 'day' ? 3 : period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip cursor={false} trigger="click" formatter={(v) => [`${v} steps`, '']} />
            <Bar
              dataKey="value" fill="#f43f5e" radius={[3, 3, 0, 0]}
              cursor={period !== 'day' ? 'pointer' : 'default'}
              onClick={handleBarClick}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Mobility & Activity" metrics={STEPS_EXTRA_METRICS} />
    </div>
  )
}
