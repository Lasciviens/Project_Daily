import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHeartRateDailySeries, computeSleepSummary } from '../../healthAggregate'
import { todayStr, daysAgoStr } from '../../../../shared/utils/dateUtils'
import type { SectionId } from './sectionTypes'

// Plain computed stats (no AI) shown where the training calendar normally
// sits — the calendar isn't relevant while browsing Health, so this reclaims
// that space with a short analysis of whichever section is active.

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function trendPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function TrendBadge({ pct, goodDirection = 'up' }: { pct: number | null; goodDirection?: 'up' | 'down' }) {
  if (pct == null || pct === 0) return null
  const isUp = pct > 0
  const isGood = goodDirection === 'up' ? isUp : !isUp
  return (
    <span className={`text-[10px] font-semibold ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
      {isUp ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

function StatRow({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ink-50 last:border-0">
      <div>
        <p className="text-xs text-ink-500">{label}</p>
        {sub && <p className="text-[10px] text-ink-300">{sub}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-bold text-ink-900">{value}</span>
        {trend}
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-ink-200 rounded-2xl p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2">📈 {title}</p>
      {children}
    </div>
  )
}

// Split a metric's daily series into "last 7 days" vs "the 7 days before that".
function splitWeeks(series: { date: string; value: number }[]) {
  const to = todayStr()
  const weekAgo = daysAgoStr(6)
  const twoWeeksAgo = daysAgoStr(13)
  const current = series.filter(d => d.date >= weekAgo && d.date <= to).map(d => d.value)
  const previous = series.filter(d => d.date >= twoWeeksAgo && d.date < weekAgo).map(d => d.value)
  return { current, previous }
}

function StepsStats() {
  const { data: points = [] } = useHealthMetricSeries('step_count', daysAgoStr(13), todayStr())
  const series = computeDailySeries('step_count', points)
  const { current, previous } = splitWeeks(series)
  const curAvg = avg(current), prevAvg = avg(previous)
  const best = series.length ? series.reduce((a, b) => (b.value > a.value ? b : a)) : null

  return (
    <Panel title="Steps analysis">
      <StatRow label="7-day average" value={curAvg != null ? Math.round(curAvg).toLocaleString('en-GB') : '—'}
        trend={<TrendBadge pct={trendPct(curAvg, prevAvg)} />} />
      {best && (
        <StatRow label="Best day" value={best.value.toLocaleString('en-GB')}
          sub={new Date(best.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })} />
      )}
      <StatRow label="Days tracked" value={String(series.length)} />
    </Panel>
  )
}

function EnergyStats() {
  const { data: activePoints = [] } = useHealthMetricSeries('active_energy', daysAgoStr(13), todayStr())
  const { data: basalPoints = [] } = useHealthMetricSeries('basal_energy_burned', daysAgoStr(13), todayStr())
  const activeSeries = computeDailySeries('active_energy', activePoints)
  const basalSeries = computeDailySeries('basal_energy_burned', basalPoints)
  const { current: curActive, previous: prevActive } = splitWeeks(activeSeries)
  const { current: curBasal } = splitWeeks(basalSeries)
  const curAvgActive = avg(curActive), prevAvgActive = avg(prevActive)
  const curAvgBasal = avg(curBasal)

  return (
    <Panel title="Energy analysis">
      <StatRow label="Avg active/day" value={curAvgActive != null ? `${Math.round(curAvgActive)} kcal` : '—'}
        trend={<TrendBadge pct={trendPct(curAvgActive, prevAvgActive)} />} />
      <StatRow label="Avg basal/day" value={curAvgBasal != null ? `${Math.round(curAvgBasal)} kcal` : '—'} />
      <StatRow label="Days tracked" value={String(activeSeries.length)} />
    </Panel>
  )
}

function HeartStats() {
  const { data: hrPoints = [] } = useHealthMetricSeries('heart_rate', daysAgoStr(13), todayStr())
  const { data: restingPoints = [] } = useHealthMetricSeries('resting_heart_rate', daysAgoStr(13), todayStr())
  const ranges = computeHeartRateDailySeries(hrPoints)
  const restingSeries = computeDailySeries('resting_heart_rate', restingPoints)
  const { current: restingCurrent, previous: restingPrevious } = splitWeeks(restingSeries)
  const curAvgResting = avg(restingCurrent), prevAvgResting = avg(restingPrevious)
  const overallMin = ranges.length ? Math.min(...ranges.map(r => r.min)) : null
  const overallMax = ranges.length ? Math.max(...ranges.map(r => r.max)) : null

  // "Today's average" — today's own avg-of-avgs across the day's windows.
  const todayAvg = ranges.find(r => r.date === todayStr())?.avg ?? null

  // "This week's intraday average" — mean of each of the last 7 days' own
  // daily average (not a single flat number across all raw points, so a
  // handful of very active/very quiet windows on one day don't skew it).
  const avgSeries = ranges.map(r => ({ date: r.date, value: r.avg }))
  const { current: weekAvgs, previous: prevWeekAvgs } = splitWeeks(avgSeries)
  const weekAvg = avg(weekAvgs)
  const prevWeekAvg = avg(prevWeekAvgs)

  return (
    <Panel title="Heart analysis">
      <StatRow label="Today's average" value={todayAvg != null ? `${Math.round(todayAvg)} bpm` : '—'} />
      <StatRow label="Week avg (intraday)" value={weekAvg != null ? `${Math.round(weekAvg)} bpm` : '—'}
        trend={<TrendBadge pct={trendPct(weekAvg, prevWeekAvg)} goodDirection="down" />} />
      <StatRow label="Avg resting HR" value={curAvgResting != null ? `${Math.round(curAvgResting)} bpm` : '—'}
        trend={<TrendBadge pct={trendPct(curAvgResting, prevAvgResting)} goodDirection="down" />} />
      {overallMin != null && overallMax != null && (
        <StatRow label="14-day range" value={`${Math.round(overallMin)}–${Math.round(overallMax)}`} sub="bpm" />
      )}
      <StatRow label="Days tracked" value={String(ranges.length)} />
    </Panel>
  )
}

function SleepStats() {
  const { data: points = [] } = useHealthMetricSeries('sleep_analysis', daysAgoStr(13), todayStr())
  const summary = computeSleepSummary(points)
  const { current, previous } = splitWeeks(summary.map(s => ({ date: s.date, value: s.total })))
  const curAvg = avg(current), prevAvg = avg(previous)
  const best = summary.length ? summary.reduce((a, b) => (b.total > a.total ? b : a)) : null

  return (
    <Panel title="Sleep analysis">
      <StatRow label="7-night average" value={curAvg != null ? `${curAvg.toFixed(1)}h` : '—'}
        trend={<TrendBadge pct={trendPct(curAvg, prevAvg)} />} />
      {best && (
        <StatRow label="Best night" value={`${best.total.toFixed(1)}h`}
          sub={new Date(best.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })} />
      )}
      <StatRow label="Nights tracked" value={String(summary.length)} />
    </Panel>
  )
}

function BodyStats() {
  const { data: points = [] } = useHealthMetricSeries('weight_body_mass', daysAgoStr(89), todayStr())
  const series = computeDailySeries('weight_body_mass', points)
  const first = series[0]?.value
  const latest = series[series.length - 1]?.value
  const delta = first != null && latest != null ? latest - first : null

  return (
    <Panel title="Body analysis">
      <StatRow label="Latest weight" value={latest != null ? `${latest.toFixed(1)} kg` : '—'} />
      {delta != null && (
        <StatRow label="Change (90 days)" value={`${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`} />
      )}
      <StatRow label="Weigh-ins" value={String(series.length)} />
    </Panel>
  )
}

function OverviewStats() {
  const today = todayStr()
  const { data: stepPoints = [] } = useHealthMetricSeries('step_count', today, today)
  const { data: activePoints = [] } = useHealthMetricSeries('active_energy', today, today)
  const { data: hrPoints = [] } = useHealthMetricSeries('heart_rate', today, today)
  const { data: sleepPoints = [] } = useHealthMetricSeries('sleep_analysis', daysAgoStr(1), today)

  const steps = computeDailySeries('step_count', stepPoints)[0]?.value
  const active = computeDailySeries('active_energy', activePoints)[0]?.value
  const hrRange = computeHeartRateDailySeries(hrPoints)[0]
  const sleep = computeSleepSummary(sleepPoints).pop()

  return (
    <Panel title="Today at a glance">
      <StatRow label="Steps" value={steps != null ? Math.round(steps).toLocaleString('en-GB') : '—'} />
      <StatRow label="Active energy" value={active != null ? `${Math.round(active)} kcal` : '—'} />
      <StatRow label="Heart rate" value={hrRange ? `${Math.round(hrRange.min)}–${Math.round(hrRange.max)}` : '—'} sub={hrRange ? 'bpm' : undefined} />
      <StatRow label="Sleep" value={sleep ? `${sleep.total.toFixed(1)}h` : '—'} />
    </Panel>
  )
}

export function HealthStatsPanel({ section }: { section: SectionId }) {
  if (section === 'steps') return <StepsStats />
  if (section === 'energy') return <EnergyStats />
  if (section === 'heart') return <HeartStats />
  if (section === 'sleep') return <SleepStats />
  if (section === 'body') return <BodyStats />
  return <OverviewStats />
}
