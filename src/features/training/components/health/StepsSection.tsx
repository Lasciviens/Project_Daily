import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHourlyBuckets } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'
import { PeriodToggle, type Period } from './PeriodToggle'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

function rangeFor(period: Period): { from: string; to: string } {
  const to = todayStr()
  if (period === 'day') return { from: to, to }
  if (period === 'week') return { from: daysAgoStr(6), to }
  return { from: daysAgoStr(29), to }
}

export function StepsSection() {
  const today = todayStr()
  const [period, setPeriod] = useState<Period>('week')

  // Today's headline numbers — independent of the chart period below.
  const { data: todayStepPoints = [], isLoading: stepsLoading } = useHealthMetricSeries('step_count', today, today)
  const { data: todayDistPoints = [] } = useHealthMetricSeries('walking_running_distance', today, today)
  const steps = computeDailySeries('step_count', todayStepPoints)[0]?.value ?? 0
  const distanceKm = computeDailySeries('walking_running_distance', todayDistPoints)[0]?.value ?? 0
  const pace = steps > 0 && distanceKm > 0 ? (distanceKm * 1000) / steps : null

  const { from, to } = rangeFor(period)
  const { data: rangePoints = [] } = useHealthMetricSeries('step_count', from, to)
  const chartData = period === 'day'
    ? computeHourlyBuckets('step_count', rangePoints)
    : computeDailySeries('step_count', rangePoints).map(d => ({ label: fmtDay(d.date), value: Math.round(d.value) }))

  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">🚶 Steps Today</p>
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

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide">
          {period === 'day' ? 'Today by hour' : period === 'week' ? 'Last 7 days' : 'Last 30 days'}
        </p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={period === 'day' ? 3 : period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip formatter={(v) => [`${v} steps`, '']} />
            <Bar dataKey="value" fill="#f43f5e" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
