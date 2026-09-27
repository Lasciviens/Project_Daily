import { useChartColors } from '../../../shared/ui'
import { fillDays } from '../healthWindowStats'
import { useHealthHourly } from '../hooks/useHealthExport'
import { useMetricWindow } from '../hooks/useHealthWindow'
import type { HealthRange } from './sectionTypes'
import { useRangeWindow, windowNoun } from './dateNav'
import { MetricMiniGrid } from './MetricMiniGrid'
import { STEPS_EXTRA_METRICS, RUNNING_EXTRA_METRICS } from './miniMetrics'
import { HealthTrendChart } from './HealthTrendChart'
import { HeadlineStat, SectionCard, SideStat, TrendBadge } from './sectionKit'
import { fmtAxisDay, fmtInt, windowCaption } from './healthFormat'

export function StepsSection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()
  const win = useRangeWindow(range)
  const isDay = win.isDay

  // Headline, side panel and Daily all read useMetricWindow, so "daily
  // average steps" is one number everywhere (H-02). Multi-day means leave
  // today's unfinished day out; Day mode on today shows it as "so far".
  const steps = useMetricWindow('step_count', win)
  const dist = useMetricWindow('walking_running_distance', win)
  const hourly = useHealthHourly('step_count', anchor, win.fetchFrom)

  const s = steps.summary
  const distanceKm = isDay ? dist.summary.value : dist.summary.total
  const pace = isDay && s.value && distanceKm ? (distanceKm * 1000) / s.value : null

  // Every hour / day of the window is on the axis; one without a reading is a
  // gap, never a zero bar (H-10).
  const chartData = isDay
    ? (hourly.data ?? []).map(h => ({ label: h.label, steps: h.value }))
    : fillDays(steps.daily, win.from, win.to).map(d => ({ label: fmtAxisDay(d.date), date: d.date, steps: d.value }))

  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const noData = !steps.isLoading && s.daysWithData === 0

  return (
    <SectionCard dimmed={steps.isPlaceholderData}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={isDay ? `Steps · ${windowNoun(period, anchor)}` : `Steps · daily average, ${windowNoun(period, anchor)}`}
          value={steps.isLoading ? '…' : fmtInt(s.value)}
          unit={!isDay && s.value != null ? '/day' : undefined}
          sub={windowCaption(s)}
          trend={<TrendBadge pct={s.deltaPct} good="up" />}
        />
        <div className="flex gap-4">
          {!isDay && <SideStat value={fmtInt(s.total)} label="total steps" />}
          <SideStat value={distanceKm != null ? distanceKm.toFixed(isDay ? 2 : 1) : '—'} label={isDay ? 'km' : 'km total'} />
          {pace != null && <SideStat value={Math.round(pace)} label="cm/step" />}
        </div>
      </div>

      {noData
        ? <p className="py-6 text-center text-meta text-fg-muted">No steps recorded {isDay ? 'on this day' : 'in this window'}.</p>
        : (
          <HealthTrendChart
            data={chartData}
            series={[{ key: 'steps', label: 'steps', color: c.series[0], kind: 'bar' }]}
            unit=""
            ariaLabel={isDay ? 'Steps per hour' : 'Steps per day'}
            height={150}
            onViewDay={isDay ? undefined : viewDay}
          />
        )}

      <MetricMiniGrid title="Mobility & activity" metrics={STEPS_EXTRA_METRICS} window={{ from: win.from, to: win.to, period }} onViewDay={viewDay} />
      <MetricMiniGrid title="Running dynamics" metrics={RUNNING_EXTRA_METRICS} window={{ from: win.from, to: win.to, period }} onViewDay={viewDay} />
    </SectionCard>
  )
}
