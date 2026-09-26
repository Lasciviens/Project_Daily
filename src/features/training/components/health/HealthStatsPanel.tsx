import { useHealthMetricSeries } from '../../hooks/useHealthExport'
import { computeDailySeries, computeHeartRateDailySeries, computeSleepSummary, formatSleepHours } from '../../healthAggregate'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { rangeForAnchor, shiftStr, labelForAnchor } from './dateNav'
import type { SectionId, HealthRange } from './sectionTypes'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'

// Plain computed stats (no AI) shown where the training calendar normally
// sits — the calendar isn't relevant while browsing Health, so this reclaims
// that space with a short analysis of whichever section is active.
//
// Every panel here used to hardcode "the last 14 days ending today" and took
// no notice of the Health tab's own date/period control, so the numbers never
// moved when you changed the day or switched Day/Week/Month — reported as
// "ya sabit ya yanlış ya eksik". Three separate defects behind that:
//
//   1. STATIC — the window was fixed, and Overview was pinned to today
//      outright, so browsing back a day changed everything on the page
//      except this panel.
//   2. WRONG — rows under a "7-day average" were computed over 14 days
//      ("best day", "days tracked"), so the headline and the supporting
//      rows described different windows. Averages also swallowed the
//      in-progress day, which drags every one of them down before evening
//      (the same defect already fixed in EnergySection's own average).
//   3. MISSING — no panel said which window it was describing, so there was
//      no way to tell a stale number from a real one.
//
// Now: one window, the selected one; a same-length preceding window for the
// trend badge; the in-progress day excluded from averages; and every panel
// prints the window it used.

interface Win {
  /** The selected window. */
  from: string
  to: string
  /** The same-length window immediately before it, for the trend badge. */
  prevFrom: string
  prevTo: string
  /** Full span including the comparison window — what to fetch in one go. */
  fetchFrom: string
  label: string
  isDay: boolean
}

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00')
  const d2 = new Date(b + 'T00:00:00')
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000)
}

function buildWindow(range: HealthRange): Win {
  const { from, to } = rangeForAnchor(range.period, range.anchor)
  const span = daysBetween(from, to) + 1
  const prevTo = shiftStr(from, -1)
  const prevFrom = shiftStr(from, -span)
  return {
    from, to, prevFrom, prevTo, fetchFrom: prevFrom,
    label: labelForAnchor(range.period, range.anchor),
    isDay: range.period === 'day',
  }
}

// Averages must not include a day that hasn't finished yet: at 09:00 today
// carries a fraction of its real steps/energy and pulls every mean down.
function completed(series: { date: string; value: number }[]): { date: string; value: number }[] {
  const t = todayStr()
  return series.filter(d => d.date !== t)
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/** Split one fetched series into the selected window and the one before it,
 *  with the in-progress day removed from both. */
function split(series: { date: string; value: number }[], w: Win) {
  const done = completed(series)
  return {
    current: done.filter(d => d.date >= w.from && d.date <= w.to),
    previous: done.filter(d => d.date >= w.prevFrom && d.date <= w.prevTo),
  }
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
    <span data-tone={isGood ? 'success' : 'danger'} className="tone-text text-micro font-semibold tabular-nums"
      title="Compared with the same-length window immediately before this one">
      {isUp ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

function StatRow({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: React.ReactNode }) {
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

function Panel({ title, win, children }: { title: string; win: Win; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="section-label">{title}</p>
      {/* Which window produced these numbers. Without it there was no way to
          tell whether a figure was for the day you were looking at or a
          leftover from a different range. */}
      <p className="mb-2 text-meta text-fg-muted">{win.label}</p>
      {children}
    </div>
  )
}

function fmtDate(dateStr: string): string {
  return fmtDateEnGB(new Date(dateStr + 'T00:00:00'), { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "Average" is meaningless for a single day — say what the number really is. */
function avgLabel(win: Win, noun: string): string {
  return win.isDay ? `${noun} that day` : `Average ${noun.toLowerCase()}/day`
}

function StepsStats({ range }: { range: HealthRange }) {
  const win = buildWindow(range)
  const { data: points = [] } = useHealthMetricSeries('step_count', win.fetchFrom, win.to)
  const series = computeDailySeries('step_count', points)
  const { current, previous } = split(series, win)
  const curAvg = avg(current.map(d => d.value)), prevAvg = avg(previous.map(d => d.value))
  const best = current.length ? current.reduce((a, b) => (b.value > a.value ? b : a)) : null
  const total = current.reduce((s, d) => s + d.value, 0)

  return (
    <Panel title="Steps analysis" win={win}>
      <StatRow label={avgLabel(win, 'Steps')} value={curAvg != null ? Math.round(curAvg).toLocaleString('en-GB') : '—'}
        trend={<TrendBadge pct={trendPct(curAvg, prevAvg)} />} />
      {!win.isDay && <StatRow label="Total in window" value={Math.round(total).toLocaleString('en-GB')} />}
      {!win.isDay && best && (
        <StatRow label="Best day" value={Math.round(best.value).toLocaleString('en-GB')} sub={fmtDate(best.date)} />
      )}
      <StatRow label="Days with data" value={String(current.length)} />
    </Panel>
  )
}

function EnergyStats({ range }: { range: HealthRange }) {
  const win = buildWindow(range)
  const { data: activePoints = [] } = useHealthMetricSeries('active_energy', win.fetchFrom, win.to)
  const { data: basalPoints = [] } = useHealthMetricSeries('basal_energy_burned', win.fetchFrom, win.to)
  const active = split(computeDailySeries('active_energy', activePoints), win)
  const basal = split(computeDailySeries('basal_energy_burned', basalPoints), win)
  const curActive = avg(active.current.map(d => d.value)), prevActive = avg(active.previous.map(d => d.value))
  const curBasal = avg(basal.current.map(d => d.value)), prevBasal = avg(basal.previous.map(d => d.value))
  const totalPerDay = curActive != null && curBasal != null ? curActive + curBasal : null

  return (
    <Panel title="Energy analysis" win={win}>
      <StatRow label={avgLabel(win, 'Active')} value={curActive != null ? `${Math.round(curActive)} kcal` : '—'}
        trend={<TrendBadge pct={trendPct(curActive, prevActive)} />} />
      <StatRow label={avgLabel(win, 'Basal')} value={curBasal != null ? `${Math.round(curBasal)} kcal` : '—'}
        trend={<TrendBadge pct={trendPct(curBasal, prevBasal)} />} />
      <StatRow label="Total burn/day" value={totalPerDay != null ? `${Math.round(totalPerDay)} kcal` : '—'} />
      <StatRow label="Days with data" value={String(active.current.length)} />
    </Panel>
  )
}

function HeartStats({ range }: { range: HealthRange }) {
  const win = buildWindow(range)
  const { data: hrPoints = [] } = useHealthMetricSeries('heart_rate', win.fetchFrom, win.to)
  const { data: restingPoints = [] } = useHealthMetricSeries('resting_heart_rate', win.fetchFrom, win.to)
  const ranges = computeHeartRateDailySeries(hrPoints)
  const inWindow = ranges.filter(r => r.date >= win.from && r.date <= win.to)
  const resting = split(computeDailySeries('resting_heart_rate', restingPoints), win)
  const curResting = avg(resting.current.map(d => d.value)), prevResting = avg(resting.previous.map(d => d.value))

  // Mean of each day's OWN average, not one flat mean over every raw point —
  // otherwise a day with many active windows outweighs a quiet one.
  const dayAvgs = split(ranges.map(r => ({ date: r.date, value: r.avg })), win)
  const curAvg = avg(dayAvgs.current.map(d => d.value)), prevAvg = avg(dayAvgs.previous.map(d => d.value))

  const lo = inWindow.length ? Math.min(...inWindow.map(r => r.min)) : null
  const hi = inWindow.length ? Math.max(...inWindow.map(r => r.max)) : null

  return (
    <Panel title="Heart analysis" win={win}>
      <StatRow label={avgLabel(win, 'Heart rate')} value={curAvg != null ? `${Math.round(curAvg)} bpm` : '—'}
        trend={<TrendBadge pct={trendPct(curAvg, prevAvg)} goodDirection="down" />} />
      <StatRow label={avgLabel(win, 'Resting HR')} value={curResting != null ? `${Math.round(curResting)} bpm` : '—'}
        trend={<TrendBadge pct={trendPct(curResting, prevResting)} goodDirection="down" />} />
      {lo != null && hi != null && (
        <StatRow label="Range in window" value={`${Math.round(lo)}–${Math.round(hi)}`} sub="bpm" />
      )}
      <StatRow label="Days with data" value={String(inWindow.length)} />
    </Panel>
  )
}

function SleepStats({ range }: { range: HealthRange }) {
  const win = buildWindow(range)
  const { data: points = [] } = useHealthMetricSeries('sleep_analysis', win.fetchFrom, win.to)
  const summary = computeSleepSummary(points)
  const { current, previous } = split(summary.map(s => ({ date: s.date, value: s.total })), win)
  const curAvg = avg(current.map(d => d.value)), prevAvg = avg(previous.map(d => d.value))
  const best = current.length ? current.reduce((a, b) => (b.value > a.value ? b : a)) : null
  const worst = current.length ? current.reduce((a, b) => (b.value < a.value ? b : a)) : null

  return (
    <Panel title="Sleep analysis" win={win}>
      <StatRow label={win.isDay ? 'Slept that night' : 'Average per night'}
        value={curAvg != null ? formatSleepHours(curAvg) : '—'}
        trend={<TrendBadge pct={trendPct(curAvg, prevAvg)} />} />
      {!win.isDay && best && <StatRow label="Best night" value={formatSleepHours(best.value)} sub={fmtDate(best.date)} />}
      {!win.isDay && worst && <StatRow label="Shortest night" value={formatSleepHours(worst.value)} sub={fmtDate(worst.date)} />}
      <StatRow label="Nights with data" value={String(current.length)} />
    </Panel>
  )
}

function BodyStats({ range }: { range: HealthRange }) {
  const win = buildWindow(range)
  // Weigh-ins are sparse and event-based, so a narrow window would usually be
  // empty. A fixed 90 days ending at the SELECTED day keeps the change figure
  // meaningful while still following the page's date control.
  const from = shiftStr(win.to, -89)
  const { data: points = [] } = useHealthMetricSeries('weight_body_mass', from, win.to)
  const { data: fatPoints = [] } = useHealthMetricSeries('body_fat_percentage', from, win.to)
  const series = computeDailySeries('weight_body_mass', points)
  const fat = computeDailySeries('body_fat_percentage', fatPoints)
  const first = series[0]
  const latest = series[series.length - 1]
  const delta = first && latest ? latest.value - first.value : null
  const latestFat = fat[fat.length - 1]

  return (
    <Panel title="Body analysis" win={win}>
      <StatRow label="Latest weight" value={latest ? `${latest.value.toFixed(1)} kg` : '—'}
        sub={latest ? fmtDate(latest.date) : undefined} />
      {latestFat && <StatRow label="Latest body fat" value={`${latestFat.value.toFixed(1)} %`} sub={fmtDate(latestFat.date)} />}
      {delta != null && first && (
        // Labelled with the real span between the two readings, not a blanket
        // "90 days" — the first reading is the earliest one that EXISTS in the
        // window, which is rarely 90 days back.
        <StatRow label="Change" value={`${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`}
          sub={`over ${daysBetween(first.date, latest!.date)} days`} />
      )}
      <StatRow label="Weigh-ins (90d)" value={String(series.length)} />
    </Panel>
  )
}

function OverviewStats({ range }: { range: HealthRange }) {
  const win = buildWindow(range)
  // Overview was pinned to today outright — it now describes the selected
  // window like every other panel.
  const { data: stepPoints = [] } = useHealthMetricSeries('step_count', win.from, win.to)
  const { data: activePoints = [] } = useHealthMetricSeries('active_energy', win.from, win.to)
  const { data: basalPoints = [] } = useHealthMetricSeries('basal_energy_burned', win.from, win.to)
  const { data: hrPoints = [] } = useHealthMetricSeries('heart_rate', win.from, win.to)
  const { data: sleepPoints = [] } = useHealthMetricSeries('sleep_analysis', win.from, win.to)

  const steps = completed(computeDailySeries('step_count', stepPoints)).filter(d => d.date >= win.from)
  const active = completed(computeDailySeries('active_energy', activePoints)).filter(d => d.date >= win.from)
  const basal = completed(computeDailySeries('basal_energy_burned', basalPoints)).filter(d => d.date >= win.from)
  const hr = computeHeartRateDailySeries(hrPoints).filter(d => d.date >= win.from)
  const sleep = computeSleepSummary(sleepPoints).filter(d => d.date >= win.from)

  const avgSteps = avg(steps.map(d => d.value))
  const avgActive = avg(active.map(d => d.value))
  const avgBasal = avg(basal.map(d => d.value))
  const avgSleep = avg(sleep.map(s => s.total))
  const lo = hr.length ? Math.min(...hr.map(r => r.min)) : null
  const hi = hr.length ? Math.max(...hr.map(r => r.max)) : null

  return (
    <Panel title={win.isDay ? 'That day at a glance' : 'Window at a glance'} win={win}>
      <StatRow label={avgLabel(win, 'Steps')} value={avgSteps != null ? Math.round(avgSteps).toLocaleString('en-GB') : '—'} />
      <StatRow label={avgLabel(win, 'Active energy')} value={avgActive != null ? `${Math.round(avgActive)} kcal` : '—'} />
      <StatRow label={avgLabel(win, 'Basal energy')} value={avgBasal != null ? `${Math.round(avgBasal)} kcal` : '—'} />
      <StatRow label="Heart rate range" value={lo != null && hi != null ? `${Math.round(lo)}–${Math.round(hi)}` : '—'}
        sub={lo != null ? 'bpm' : undefined} />
      <StatRow label={win.isDay ? 'Sleep' : 'Average sleep'} value={avgSleep != null ? formatSleepHours(avgSleep) : '—'} />
    </Panel>
  )
}

export function HealthStatsPanel({ section, range }: { section: SectionId; range: HealthRange }) {
  if (section === 'steps') return <StepsStats range={range} />
  if (section === 'energy') return <EnergyStats range={range} />
  if (section === 'heart') return <HeartStats range={range} />
  if (section === 'sleep') return <SleepStats range={range} />
  if (section === 'body') return <BodyStats range={range} />
  return <OverviewStats range={range} />
}
