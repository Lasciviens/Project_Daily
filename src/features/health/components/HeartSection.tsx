import { useChartColors } from '../../../shared/ui'
import { fillDays } from '../healthWindowStats'
import { useHeartRateHourly } from '../hooks/useHealthExport'
import { useHeartWindow, useMetricWindow } from '../hooks/useHealthWindow'
import type { HealthRange } from './sectionTypes'
import { useRangeWindow, windowNoun } from './dateNav'
import { MetricMiniGrid } from './MetricMiniGrid'
import { HEART_EXTRA_METRICS } from './miniMetrics'
import { HealthTrendChart } from './HealthTrendChart'
import { RecoveryTrend } from './RecoveryTrend'
import { HeadlineStat, SectionCard, SideStat, TrendBadge } from './sectionKit'
import { fmtAxisDay, windowCaption } from './healthFormat'

const r = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v)))

export function HeartSection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()
  const win = useRangeWindow(range)
  const isDay = win.isDay

  const heart = useHeartWindow(win)
  const resting = useMetricWindow('resting_heart_rate', win, { kind: 'average', todayComplete: true })
  const hrv = useMetricWindow('heart_rate_variability', win)
  const hourly = useHeartRateHourly(anchor, win.fetchFrom)

  const day = isDay ? heart.daily.find(d => d.date === anchor) : undefined
  const dayRange = day && day.min != null && day.max != null ? `${Math.round(day.min)}–${Math.round(day.max)}` : null

  // An hour with no reading — every future hour of today, a charging hour —
  // is a gap, not a plunge to 0 bpm (H-03).
  const chartData = isDay
    ? (hourly.data ?? []).map(h => ({ label: h.label, avg: h.avg }))
    : fillDays(heart.daily.filter(d => d.avg != null).map(d => ({ date: d.date, value: d.avg as number })), win.from, win.to)
        .map(d => ({ label: fmtAxisDay(d.date), date: d.date, avg: d.value }))

  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const noData = !heart.isLoading && !heart.daily.some(d => d.date >= win.from && d.date <= win.to)

  return (
    <SectionCard dimmed={heart.isPlaceholderData}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={isDay ? `Heart rate ${dayRange ? 'range' : 'average'} · ${windowNoun(period, anchor)}` : `Average heart rate · ${windowNoun(period, anchor)}`}
          value={heart.isLoading ? '…' : isDay ? (dayRange ?? r(day?.avg)) : r(heart.summary.value)}
          unit={(isDay ? (dayRange ?? day?.avg) : heart.summary.value) != null ? 'bpm' : undefined}
          sub={isDay ? (heart.summary.partialToday ? 'So far today' : null) : windowCaption(heart.summary)}
          // All-day average heart rate has no "better" direction: it moves
          // with how active the day was. The badge stays neutral (H-13).
          trend={isDay ? null : <TrendBadge pct={heart.summary.deltaPct} />}
        />
        <div className="flex gap-4">
          {!isDay && heart.lo != null && heart.hi != null && <SideStat value={`${Math.round(heart.lo)}–${Math.round(heart.hi)}`} label="range" />}
          {resting.summary.value != null && <SideStat value={r(resting.summary.value)} label={isDay ? 'resting' : 'avg resting'} />}
          {hrv.summary.value != null && <SideStat value={r(hrv.summary.value)} label={isDay ? 'HRV ms' : 'avg HRV ms'} />}
        </div>
      </div>

      {noData
        ? <p className="py-6 text-center text-meta text-fg-muted">No heart rate recorded {isDay ? 'on this day' : 'in this window'}.</p>
        : (
          <HealthTrendChart
            data={chartData}
            series={[{ key: 'avg', label: 'average', color: c.series[3], kind: 'line' }]}
            unit="bpm"
            ariaLabel={isDay ? 'Average heart rate per hour' : 'Average heart rate per day'}
            height={150}
            onViewDay={isDay ? undefined : viewDay}
          />
        )}

      {/* Resting HR and HRV are the recovery markers; average HR mostly
          reflects how active the day was. Each gets its own trend against
          your usual range over the last 60 days (H-13). */}
      <RecoveryTrend metric="resting_heart_rate" title="Resting heart rate" unit="bpm" color={c.series[3]}
        to={win.to} from={win.from} onViewDay={viewDay} />
      <RecoveryTrend metric="heart_rate_variability" title="HRV (SDNN)" unit="ms" color={c.series[1]}
        to={win.to} from={win.from} rolling onViewDay={viewDay} />

      <MetricMiniGrid title="Cardio extras" metrics={HEART_EXTRA_METRICS} window={{ from: win.from, to: win.to, period }} onViewDay={viewDay} />
    </SectionCard>
  )
}
