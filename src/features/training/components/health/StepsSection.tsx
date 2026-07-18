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

  // Headline follows the SELECTED PERIOD, not always a single day: Day →
  // that day's total; Week/Month → daily average + period totals, computed
  // from the same range the chart shows (in Day mode from==to==anchor, so
  // these queries dedupe with what the old anchor-only queries fetched).
  const isDay = period === 'day'
  const { from, to } = rangeForAnchor(period, anchor)
  const { data: rangePoints = [], isLoading: stepsLoading } = useHealthMetricSeries('step_count', from, to)
  const { data: rangeDistPoints = [] } = useHealthMetricSeries('walking_running_distance', from, to)

  const stepDays = computeDailySeries('step_count', rangePoints)
  const distDays = computeDailySeries('walking_running_distance', rangeDistPoints)
  const totalSteps = stepDays.reduce((s, d) => s + d.value, 0)
  const totalKm = distDays.reduce((s, d) => s + d.value, 0)
  const avgSteps = stepDays.length ? totalSteps / stepDays.length : 0

  // Day-mode figures (single-day range → at most one series entry)
  const steps = isDay ? (stepDays[0]?.value ?? 0) : avgSteps
  const distanceKm = isDay ? (distDays[0]?.value ?? 0) : totalKm
  const pace = isDay && steps > 0 && distanceKm > 0 ? (distanceKm * 1000) / steps : null

  const chartData: { label: string; date?: string; value: number }[] = isDay
    ? computeHourlyBuckets('step_count', rangePoints).map(h => ({ label: h.label, value: Math.round(h.value) }))
    : stepDays.map(d => ({ label: fmtDay(d.date), date: d.date, value: Math.round(d.value) }))

  function goToDay(date: string) {
    setPeriod('day'); setAnchor(date)
  }

  // Clean custom tooltip — the default recharts tooltip rendered the value as
  // a bare "': 514 steps'" line (empty series name + colon), which read as
  // broken. Hovering shows the value immediately; the explicit "Go to this
  // day" button inside is the ONLY thing that navigates (clicking the bar
  // itself used to jump straight to the day, killing any chance to glance at
  // the number without losing your place).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; we only read a few fields.
  function StepsTooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    const date: string | undefined = payload[0]?.payload?.date
    const value: number | undefined = payload[0]?.value
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs space-y-0.5">
        <p className="text-ink-400 font-medium">{label}</p>
        <p className="font-semibold text-rose-600">{value != null ? `${value.toLocaleString('en-GB')} steps` : '—'}</p>
        {period !== 'day' && date && (
          <button
            type="button"
            onClick={() => goToDay(date)}
            className="text-accent-600 underline text-xs py-1.5 block min-h-[32px]"
          >
            Go to this day →
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            🚶 Steps {isDay
              ? (anchor === today ? 'Today' : `· ${labelForAnchor('day', anchor)}`)
              : period === 'week' ? '· Weekly Average' : '· Monthly Average'}
          </p>
          <p className="text-3xl font-bold text-ink-900 leading-tight">
            {stepsLoading ? '…' : Math.round(steps).toLocaleString('en-GB')}
            {!isDay && <span className="text-sm font-normal text-ink-400"> /day</span>}
          </p>
        </div>
        <div className="flex gap-4">
          {!isDay && (
            <div className="text-center">
              <p className="text-lg font-bold text-ink-800">{Math.round(totalSteps).toLocaleString('en-GB')}</p>
              <p className="text-[10px] text-ink-400">total steps</p>
            </div>
          )}
          <div className="text-center">
            <p className="text-lg font-bold text-ink-800">{distanceKm.toFixed(isDay ? 2 : 1)}</p>
            <p className="text-[10px] text-ink-400">{isDay ? 'km' : 'km total'}</p>
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
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={period === 'day' ? 3 : period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
            {/* Hover trigger (default): the value must be visible the moment
                the pointer is over a bar — click is reserved for the
                "Go to this day" button inside the tooltip. pointerEvents:
                recharts tooltips are pointer-events:none by default, which
                would make that button unclickable. */}
            <Tooltip cursor={false} content={StepsTooltipContent} wrapperStyle={{ pointerEvents: 'auto' }} />
            <Bar dataKey="value" fill="#f43f5e" radius={[3, 3, 0, 0]} activeBar={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Mobility & Activity" metrics={STEPS_EXTRA_METRICS} />
    </div>
  )
}
