import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHourlyBuckets } from '../../healthAggregate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { HealthRange } from './sectionTypes'
import { rangeForAnchor, labelForAnchor } from './dateNav'
import { MetricMiniGrid } from './MetricMiniGrid'
import { STEPS_EXTRA_METRICS, RUNNING_EXTRA_METRICS } from './miniMetrics'
import { compactAxisTick } from './axisFormat'
import { useChartColors } from '../../../../shared/ui'
import { TOOLTIP_BOX } from '../chartKit'
import { HeadlineStat, SectionCard, SideStat } from './sectionKit'

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export function StepsSection({ range }: { range: HealthRange }) {
  const today = todayStr()
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()

  // The mini-metric cards read the SAME window the rest of the page is on
  // (they used to be pinned to the last 7 days ending today, so they sat
  // frozen while this control moved).
  const miniWindow = { ...rangeForAnchor(period, anchor), period }

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
      <div className={TOOLTIP_BOX}>
        <p className="font-medium text-fg-muted">{label}</p>
        <p className="font-semibold text-fg">{value != null ? `${value.toLocaleString('en-GB')} steps` : '—'}</p>
        {period !== 'day' && date && (
          <button
            type="button"
            onClick={() => goToDay(date)}
            className="flex min-h-[44px] items-center py-1.5 text-meta font-semibold text-accent-600"
          >
            Go to this day →
          </button>
        )}
      </div>
    )
  }

  return (
    <SectionCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={<>Steps {isDay
            ? (anchor === today ? 'today' : `· ${labelForAnchor('day', anchor)}`)
            : period === 'week' ? '· weekly average' : '· monthly average'}</>}
          value={stepsLoading ? '…' : Math.round(steps).toLocaleString('en-GB')}
          unit={!isDay ? '/day' : undefined}
        />
        <div className="flex gap-4">
          {!isDay && <SideStat value={Math.round(totalSteps).toLocaleString('en-GB')} label="total steps" />}
          <SideStat value={distanceKm.toFixed(isDay ? 2 : 1)} label={isDay ? 'km' : 'km total'} />
          {pace != null && <SideStat value={Math.round(pace)} label="cm/step" />}
        </div>
      </div>

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} interval={period === 'day' ? 3 : period === 'month' ? 3 : 0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} />
            {/* Hover trigger (default): the value must be visible the moment
                the pointer is over a bar — click is reserved for the
                "Go to this day" button inside the tooltip. pointerEvents:
                recharts tooltips are pointer-events:none by default, which
                would make that button unclickable. */}
            <Tooltip cursor={false} content={StepsTooltipContent} wrapperStyle={{ pointerEvents: 'auto' }} />
            {/* maxBarSize: a single-day series would otherwise stretch one bar
                across the whole plot area, reading as a solid slab / render
                error rather than as one data point. */}
            <Bar dataKey="value" fill={c.series[0]} radius={[3, 3, 0, 0]} activeBar={false} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricMiniGrid title="Mobility & activity" metrics={STEPS_EXTRA_METRICS} window={miniWindow} />
      <MetricMiniGrid title="Running dynamics" metrics={RUNNING_EXTRA_METRICS} window={miniWindow} />
    </SectionCard>
  )
}
