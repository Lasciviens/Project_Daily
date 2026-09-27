import type { ReactNode } from 'react'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { formatSleepHours } from '../healthAggregate'
import { daysBetweenIso, linearTrendPerDay, type HealthWindow, type WindowSummary } from '../healthWindowStats'
import { BODYWEIGHT_SOURCE_LABEL } from '../bodyweight'
import { useEnergyWindow, useHeartWindow, useMetricWindow, useSleepWindow } from '../hooks/useHealthWindow'
import { useBodyweightSeries, useLatestBodyweight } from '../hooks/useBodyweight'
import { labelForAnchor, useRangeWindow } from './dateNav'
import type { SectionId, HealthRange } from './sectionTypes'
import { TrendBadge } from './sectionKit'
import { fmtAxisDay, fmtDayMonth, fmtInt } from './healthFormat'

// Plain computed stats for the active section, beside it. Every figure comes
// from the SAME window hooks the section headline uses (useMetricWindow and
// friends), so a labelled number can't disagree with the one next to it
// (H-02), and the in-progress-day rule is healthWindowStats' one rule: today
// counts as "so far" in Day mode, stays out of multi-day means for activity,
// and last night always counts for sleep (H-01 / T06).

function StatRow({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line py-1.5 last:border-0">
      <div className="min-w-0">
        <p className="text-meta text-fg-muted">{label}</p>
        {sub && <p className="text-micro font-normal text-fg-faint">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-body font-bold tabular-nums text-fg">{value}</span>
        {trend}
      </div>
    </div>
  )
}

function Panel({ title, label, dimmed, children }: { title: string; label: string; dimmed?: boolean; children: ReactNode }) {
  return (
    <div className={`card p-4 transition-opacity ${dimmed ? 'opacity-60' : ''}`}>
      <p className="section-label">{title}</p>
      <p className="mb-2 text-meta text-fg-muted">{label}</p>
      {children}
    </div>
  )
}

/** "Steps that day" / "Steps today so far" / "Resting HR today" / "Average steps/day". */
function avgLabel(s: WindowSummary, noun: string, win: HealthWindow): string {
  if (s.totalDays === 1) return s.partialToday ? `${noun} today so far` : win.to === win.today ? `${noun} today` : `${noun} that day`
  return `Average ${noun.toLowerCase()}/day`
}
function countSub(s: WindowSummary, noun = 'days'): string | undefined {
  if (s.totalDays === 1) return undefined
  return s.partialToday ? `${s.daysCounted} finished ${noun}; today counts once it ends` : `${s.daysCounted} ${noun} with data`
}

function StepsStats({ win, label }: { win: HealthWindow; label: string }) {
  const { summary: s, isPlaceholderData } = useMetricWindow('step_count', win)
  return (
    <Panel title="Steps" label={label} dimmed={isPlaceholderData}>
      <StatRow label={avgLabel(s, 'Steps', win)} value={fmtInt(s.value)} sub={countSub(s)} trend={<TrendBadge pct={s.deltaPct} good="up" />} />
      {!win.isDay && <StatRow label="Total in window" value={fmtInt(s.total)} />}
      {!win.isDay && s.best && <StatRow label="Best day" value={fmtInt(s.best.value)} sub={fmtAxisDay(s.best.date)} />}
      <StatRow label="Days with data" value={`${s.daysWithData} of ${s.totalDays}`} />
    </Panel>
  )
}

function EnergyStats({ win, label }: { win: HealthWindow; label: string }) {
  const e = useEnergyWindow(win)
  const kcal = (v: number | null) => (v != null ? `${fmtInt(v)} kcal` : '—')
  return (
    <Panel title="Energy" label={label} dimmed={e.isPlaceholderData}>
      <StatRow label={avgLabel(e.activeSummary, 'Active', win)} value={kcal(e.activeSummary.value)} trend={<TrendBadge pct={e.activeSummary.deltaPct} />} />
      <StatRow label={avgLabel(e.basalSummary, 'Basal', win)} value={kcal(e.basalSummary.value)} trend={<TrendBadge pct={e.basalSummary.deltaPct} />} />
      <StatRow label={avgLabel(e.totalSummary, 'Total burn', win)} value={kcal(e.totalSummary.value)} sub={countSub(e.totalSummary)} />
    </Panel>
  )
}

function HeartStats({ win, label }: { win: HealthWindow; label: string }) {
  const h = useHeartWindow(win)
  const resting = useMetricWindow('resting_heart_rate', win, { kind: 'average', todayComplete: true })
  const bpm = (v: number | null) => (v != null ? `${Math.round(v)} bpm` : '—')
  return (
    <Panel title="Heart" label={label} dimmed={h.isPlaceholderData}>
      {/* All-day average HR moves with activity: no "better" direction, so
          its trend is neutral. A lower resting HR is the fitness signal. */}
      <StatRow label={avgLabel(h.summary, 'Heart rate', win)} value={bpm(h.summary.value)} trend={<TrendBadge pct={h.summary.deltaPct} />} />
      <StatRow label={avgLabel(resting.summary, 'Resting HR', win)} value={bpm(resting.summary.value)} trend={<TrendBadge pct={resting.summary.deltaPct} good="down" />} />
      {h.lo != null && h.hi != null && <StatRow label="Range in window" value={`${Math.round(h.lo)}–${Math.round(h.hi)}`} sub="bpm" />}
      <StatRow label="Days with data" value={`${h.summary.daysWithData} of ${h.summary.totalDays}`} />
    </Panel>
  )
}

function SleepStats({ win, label }: { win: HealthWindow; label: string }) {
  const { summary: s, isPlaceholderData } = useSleepWindow(win)
  return (
    <Panel title="Sleep" label={label} dimmed={isPlaceholderData}>
      <StatRow label={win.isDay ? (win.to === win.today ? 'Slept last night' : 'Slept that night') : 'Average per night'} value={s.value != null ? formatSleepHours(s.value) : '—'}
        trend={<TrendBadge pct={s.deltaPct} good="up" />} />
      {!win.isDay && s.best && <StatRow label="Longest night" value={formatSleepHours(s.best.value)} sub={fmtAxisDay(s.best.date)} />}
      {!win.isDay && s.worst && <StatRow label="Shortest night" value={formatSleepHours(s.worst.value)} sub={fmtAxisDay(s.worst.date)} />}
      <StatRow label="Nights with data" value={`${s.daysWithData} of ${s.totalDays}`} />
    </Panel>
  )
}

function BodyStats({ anchor, label }: { anchor: string; label: string }) {
  // Weigh-ins are sparse: the same 90 days ending at the viewed day as the
  // Body section (one shared read), and the latest reading ever up to it.
  const from = shiftDateStr(anchor, -89)
  const series = useBodyweightSeries(from, anchor)
  const latest = useLatestBodyweight(anchor).data
  const points = series.data ?? []
  const recent = points.filter(p => daysBetweenIso(p.date, anchor) <= 27)
  const trend = recent.length >= 3 && daysBetweenIso(recent[0].date, recent[recent.length - 1].date) >= 7
    ? linearTrendPerDay(recent.map(p => ({ date: p.date, value: p.kg })))
    : null
  const perWeek = trend ? trend.slopePerDay * 7 : null
  const latestFat = [...points].reverse().find(p => p.fatPct != null)
  return (
    <Panel title="Body" label={label} dimmed={series.isPlaceholderData}>
      <StatRow label="Latest weight" value={latest ? `${latest.kg.toFixed(1)} kg` : '—'}
        sub={latest ? `${fmtDayMonth(latest.date)} · ${BODYWEIGHT_SOURCE_LABEL[latest.source]}` : undefined} />
      {latestFat && <StatRow label="Latest body fat" value={`${(latestFat.fatPct as number).toFixed(1)} %`} sub={fmtDayMonth(latestFat.date)} />}
      {perWeek != null && (
        <StatRow label="Trend" value={`${perWeek > 0 ? '+' : perWeek < 0 ? '−' : '±'}${Math.abs(perWeek).toFixed(2)} kg/week`}
          sub={`last 4 weeks · ${recent.length} weigh-ins`} />
      )}
      <StatRow label="Weigh-ins (90 days)" value={String(points.length)} />
    </Panel>
  )
}

function OverviewStats({ win, label }: { win: HealthWindow; label: string }) {
  const steps = useMetricWindow('step_count', win).summary
  const energy = useEnergyWindow(win)
  const heart = useHeartWindow(win)
  const sleep = useSleepWindow(win).summary
  return (
    <Panel title={win.isDay ? 'That day at a glance' : 'Window at a glance'} label={label}>
      <StatRow label={avgLabel(steps, 'Steps', win)} value={fmtInt(steps.value)} />
      <StatRow label={avgLabel(energy.activeSummary, 'Active energy', win)} value={energy.activeSummary.value != null ? `${fmtInt(energy.activeSummary.value)} kcal` : '—'} />
      <StatRow label={avgLabel(energy.basalSummary, 'Basal energy', win)} value={energy.basalSummary.value != null ? `${fmtInt(energy.basalSummary.value)} kcal` : '—'} />
      <StatRow label="Heart rate range" value={heart.lo != null && heart.hi != null ? `${Math.round(heart.lo)}–${Math.round(heart.hi)}` : '—'}
        sub={heart.lo != null ? 'bpm' : undefined} />
      <StatRow label={win.isDay ? (win.to === win.today ? 'Sleep last night' : 'Sleep that night') : 'Average sleep'} value={sleep.value != null ? formatSleepHours(sleep.value) : '—'} />
    </Panel>
  )
}

export function HealthStatsPanel({ section, range }: { section: SectionId; range: HealthRange }) {
  const win = useRangeWindow(range)
  const label = labelForAnchor(range.period, range.anchor)
  return (
    <ErrorBoundary key={section} label="Health stats" action="health_stats_panel">
      {section === 'steps' ? <StepsStats win={win} label={label} />
        : section === 'energy' ? <EnergyStats win={win} label={label} />
        : section === 'heart' ? <HeartStats win={win} label={label} />
        : section === 'sleep' ? <SleepStats win={win} label={label} />
        : section === 'body' ? <BodyStats anchor={range.anchor} label={`90 days to ${fmtDayMonth(range.anchor)}`} />
        : <OverviewStats win={win} label={label} />}
    </ErrorBoundary>
  )
}
