import { useChartColors } from '../../../shared/ui'
import { normalizeSpo2 } from '../benchmarks/healthBenchmarks'
import { useHeartRateHourly } from '../hooks/useHealthExport'
import { useHeartWindow, useMetricWindow } from '../hooks/useHealthWindow'
import type { HealthWindow } from '../healthWindowStats'
import type { HealthRange } from './sectionTypes'
import { useRangeWindow, windowNoun } from './dateNav'
import { HealthTrendChart } from './HealthTrendChart'
import { RecoveryTrend } from './RecoveryTrend'
import { HeadlineStat, SectionCard, SideStat, TrendBadge } from './sectionKit'
import { windowCaption } from './healthFormat'

const r = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v)))

// heart_rate is the densest metric by far, so its range reads ONLY the
// selected window (not the page's long download) and only up to 30 days.
function HeartRangeStat({ win, isDay, anchor }: { win: HealthWindow; isDay: boolean; anchor: string }) {
  const heart = useHeartWindow({ ...win, fetchFrom: win.from })
  if (isDay) {
    const day = heart.daily.find(d => d.date === anchor)
    return day && day.min != null && day.max != null
      ? <SideStat value={`${Math.round(day.min)}–${Math.round(day.max)}`} label="HR range bpm" /> : null
  }
  return heart.lo != null && heart.hi != null ? <SideStat value={`${Math.round(heart.lo)}–${Math.round(heart.hi)}`} label="HR range" /> : null
}

// Heart & overnight vitals. Resting HR and HRV are the recovery markers, each
// against your own usual range; the overnight vitals follow (SpO₂ with the
// 95% line, respiratory rate, wrist temperature as a deviation) and walking
// HR as a daily fitness proxy. The all-day heart-rate curve is a DAY view only
// (ranking tier 3): an all-day average mostly says how active the day was, so
// comparing it across days means little.
export function HeartSection({ range }: { range: HealthRange }) {
  const { anchor, setAnchor, period, setPeriod } = range
  const c = useChartColors()
  const win = useRangeWindow(range)
  const isDay = win.isDay

  const resting = useMetricWindow('resting_heart_rate', win, { kind: 'average', todayComplete: true })
  const hrv = useMetricWindow('heart_rate_variability', win, { todayComplete: true })
  // The hourly curve is a Day-view chart; read just that day (the heaviest
  // metric — never the long window).
  const hourly = useHeartRateHourly(anchor, anchor)
  const chartData = (hourly.data ?? []).map(h => ({ label: h.label, avg: h.avg }))

  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const common = { from: win.from, to: win.to, fetchFrom: win.fetchFrom, onViewDay: viewDay }
  const s = resting.summary

  return (
    <SectionCard dimmed={resting.isPlaceholderData}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HeadlineStat
          label={isDay ? `Resting heart rate · ${windowNoun(period, anchor)}` : `Resting heart rate · average, ${windowNoun(period, anchor)}`}
          value={resting.isLoading ? '…' : r(s.value)}
          unit={s.value != null ? 'bpm' : undefined}
          sub={isDay ? null : windowCaption(s)}
          trend={<TrendBadge pct={s.deltaPct} good="down" />}
        />
        <div className="flex gap-4">
          {hrv.summary.value != null && <SideStat value={r(hrv.summary.value)} label={isDay ? 'HRV ms' : 'avg HRV ms'} />}
          {win.totalDays <= 30 && <HeartRangeStat win={win} isDay={isDay} anchor={anchor} />}
        </div>
      </div>

      {isDay && chartData.some(d => d.avg != null) && (
        <div>
          <p className="section-label mb-1">Heart rate through the day</p>
          <HealthTrendChart
            data={chartData}
            series={[{ key: 'avg', label: 'average', color: c.series[3], kind: 'line' }]}
            unit="bpm"
            ariaLabel="Average heart rate per hour"
            height={140}
          />
        </div>
      )}

      <RecoveryTrend metric="resting_heart_rate" title="Resting heart rate" unit="bpm" color={c.series[3]} rolling {...common} />
      <RecoveryTrend metric="heart_rate_variability" title="HRV (SDNN)" unit="ms" color={c.series[1]} rolling {...common} />
      <RecoveryTrend metric="blood_oxygen_saturation" title="Blood oxygen (SpO₂)" unit="%" color={c.series[0]}
        transform={normalizeSpo2} range={{ mode: 'sd', k: 2, minHalfWidth: 1 }}
        rangeText="your 60-day average ± 2 standard deviations (at least ± 1 point)"
        refLines={[{ y: 95, label: '95%' }]} {...common} />
      <RecoveryTrend metric="respiratory_rate" title="Respiratory rate (sleep)" unit="br/min" decimals={1} color={c.series[4]}
        range={{ mode: 'median', halfWidth: 1.5 }} rangeText="your 60-day median ± 1.5 breaths a minute" {...common} />
      <RecoveryTrend metric="apple_sleeping_wrist_temperature" title="Wrist temperature (sleep)" unit="°C" decimals={1} color={c.series[5]}
        deviation range={{ mode: 'sd', k: 2, minHalfWidth: 0.3 }}
        rangeText="your 60-night average ± 2 standard deviations (at least ± 0.3 °C); a rise lasting several nights is what matters" {...common} />
      <RecoveryTrend metric="walking_heart_rate_average" title="Walking heart rate" unit="bpm" color={c.series[2]} rolling rollingDays={14} {...common} />
    </SectionCard>
  )
}
