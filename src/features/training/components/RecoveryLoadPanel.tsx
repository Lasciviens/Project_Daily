import { useMemo } from 'react'
import { Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, BarChart, LineChart } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { useHealthMetricSeries } from '../hooks/useHealthExport'
import { computeSleepSummary, computeDailySeries, formatSleepHours } from '../healthAggregate'
import { computeWeeklyVolumeTrend } from '../progressAggregate'
import { computeWeeklySleepTrend, computeWeeklyRestingHRTrend } from '../recoveryAggregate'
import { lastCompleteWeek } from '../trainingInsights'
import { fmtWeekRange, nowMs } from '../dateFormat'
import { Skeleton, useChartColors } from '../../../shared/ui'
import { useTooltipStyle } from './chartKit'
import { ChartCard, ChartEmpty, ChartNote } from './ChartCard'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

// ─────────────────────────────────────────────────────────────────────────────
//  Recovery vs Load — a follow-up sports-scientist review (2026-08-31) of the
//  item deferred when the Progress tab first shipped. Ships as THREE STACKED
//  LANES sharing one weekly X axis (tonnage, sleep, resting heart rate) —
//  deliberately NOT a dual-axis overlay, which lets two arbitrary scales be
//  tuned until any two series look coupled (a causality claim made with a
//  scale factor instead of words), and deliberately NOT a computed composite
//  "readiness" score, which this app's own house rule forbids. Nothing here
//  predicts anything — it's three real measurements on one timeline.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 182

function fmtWeek(dateStr: string): string {
  return fmtDateEnGB(new Date(dateStr + 'T00:00:00'), { day: 'numeric', month: 'short' })
}

// A single date ("3 Aug") is ambiguous for a WEEKLY value — real user
// confusion (2026-09-01) asked for the week's own Mon-Sun range instead.
// Shared across all three lanes' Tooltips below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts labelFormatter's props type is awkward to import cleanly.
function weekRangeLabelFormatter(_label: any, payload: any): string {
  const weekStart = payload?.[0]?.payload?.weekStart
  return weekStart ? fmtWeekRange(weekStart) : _label
}

// A pure auto-domain on a physiological line lane (sleep hours, resting HR)
// zooms a genuinely small week-to-week wobble into a visual cliff — the
// same "two arbitrary scales can be tuned to look coupled" hazard this
// panel's own header comment rejects for a dual-axis chart, just committed
// by accident here (sports-scientist review, 2026-09-01). Enforcing a
// minimum span keeps normal noise looking like noise.
function domainWithMinSpan(values: (number | null)[], minSpan: number): [number, number] {
  const real = values.filter((v): v is number => v != null)
  if (real.length === 0) return [0, minSpan]
  const min = Math.min(...real)
  const max = Math.max(...real)
  const span = max - min
  if (span >= minSpan) return [min, max]
  const pad = (minSpan - span) / 2
  return [Math.round((min - pad) * 10) / 10, Math.round((max + pad) * 10) / 10]
}

export function RecoveryLoadPanel() {
  const { data: training, isLoading: loadingTraining } = useTrainingHistory()
  const c = useChartColors()
  const tip = useTooltipStyle()
  const tick = { fontSize: 9, fill: c.axis }

  const toStr = new Date().toISOString().slice(0, 10)
  const fromStr = new Date(nowMs() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)

  const { data: sleepPoints = [], isLoading: loadingSleep } = useHealthMetricSeries('sleep_analysis', fromStr, toStr)
  const { data: rhrPoints = [], isLoading: loadingRhr } = useHealthMetricSeries('resting_heart_rate', fromStr, toStr)

  const isLoading = loadingTraining || loadingSleep || loadingRhr

  // One shared set of week labels — every lane maps onto the SAME weeks (a
  // week with no data on one lane still reserves its column) so the three
  // stay visually aligned even though they're three separate chart
  // instances (recharts has no built-in shared-X-axis-across-charts primitive).
  const weeks = useMemo(() => {
    const tonnage = training ? computeWeeklyVolumeTrend(training.sets, training.templates) : []
    const sleep = computeWeeklySleepTrend(computeSleepSummary(sleepPoints))
    const rhr = computeWeeklyRestingHRTrend(computeDailySeries('resting_heart_rate', rhrPoints))
    const all = new Set<string>([...tonnage.map(w => w.weekStart), ...sleep.map(w => w.weekStart), ...rhr.map(w => w.weekStart)])
    const sortedWeeks = [...all].sort()

    const tonnageByWeek = new Map(tonnage.map(w => [w.weekStart, w.tonnageKg]))
    const sleepByWeek = new Map(sleep.map(w => [w.weekStart, w]))
    const rhrByWeek = new Map(rhr.map(w => [w.weekStart, w]))

    // Exclude the current, still-in-progress week — same partial-week
    // caveat as WeeklyVolumeChart/WeeklySetsPerMuscleChart now guard against.
    const last = lastCompleteWeek(toStr)
    return sortedWeeks
      .filter(weekStart => weekStart <= last)
      .map(weekStart => ({
        weekStart,
        label: fmtWeek(weekStart),
        tonnageKg: tonnageByWeek.get(weekStart) ?? 0,
        sleepHours: sleepByWeek.get(weekStart)?.avgHours ?? null,
        sleepNights: sleepByWeek.get(weekStart)?.nights ?? 0,
        rhrBpm: rhrByWeek.get(weekStart)?.medianBpm ?? null,
        rhrDays: rhrByWeek.get(weekStart)?.days ?? 0,
      }))
  }, [training, sleepPoints, rhrPoints, toStr])

  const sleepDomain = useMemo(() => domainWithMinSpan(weeks.map(w => w.sleepHours), 2), [weeks])
  const rhrDomain = useMemo(() => domainWithMinSpan(weeks.map(w => w.rhrBpm), 10), [weeks])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-56" />
  if (weeks.length === 0) {
    return (
      <ChartCard title="Recovery inputs alongside load">
        <ChartEmpty>No training, sleep or heart-rate data in the last 6 months yet.</ChartEmpty>
      </ChartCard>
    )
  }

  const xInterval = Math.ceil(weeks.length / 8)

  return (
    <ChartCard title="Recovery inputs alongside load">
      <p className="text-meta text-fg-muted">Weekly tonnage</p>
      <div style={{ height: 72 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeks} margin={{ top: 2, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval={xInterval} />
            {/* Zero-based on purpose — a Bar's height needs to mean "how big
                is this number", and an auto-computed non-zero minimum made a
                real week of training look like a near-empty sliver. */}
            <YAxis tick={tick} axisLine={false} tickLine={false} width={32} domain={[0, 'auto']} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly. */}
            <Tooltip cursor={false} formatter={(v: any) => [`${Number(v).toLocaleString('en-GB')} kg`, 'Tonnage']} labelFormatter={weekRangeLabelFormatter} contentStyle={tip.contentStyle} labelStyle={tip.labelStyle} />
            <Bar dataKey="tonnageKg" fill={c.series[1]} fillOpacity={0.35} radius={[3, 3, 0, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-meta text-fg-muted">Average nightly sleep (hours)</p>
      <div style={{ height: 64 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={weeks} margin={{ top: 2, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval={xInterval} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={32} domain={sleepDomain} />
            <Tooltip
              cursor={false}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
              formatter={(v: any, _n: any, entry: any) => [v == null ? 'not enough nights tracked' : `${formatSleepHours(Number(v))} (${entry?.payload?.sleepNights}/7 nights)`, 'Sleep']}
              labelFormatter={weekRangeLabelFormatter}
              contentStyle={tip.contentStyle}
              labelStyle={tip.labelStyle}
            />
            <Line dataKey="sleepHours" stroke={c.series[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-meta text-fg-muted">Weekly resting heart rate (median, bpm)</p>
      <div style={{ height: 64 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={weeks} margin={{ top: 2, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval={xInterval} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={32} domain={rhrDomain} />
            <Tooltip
              cursor={false}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
              formatter={(v: any, _n: any, entry: any) => [v == null ? 'not enough days tracked' : `${v} bpm (${entry?.payload?.rhrDays}/7 days)`, 'Resting HR']}
              labelFormatter={weekRangeLabelFormatter}
              contentStyle={tip.contentStyle}
              labelStyle={tip.labelStyle}
            />
            <Line dataKey="rhrBpm" stroke={c.series[3]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ChartNote className="mt-1 flex flex-col gap-1">
        <p>
          Three separate measurements on one timeline — not combined into a score, and nothing here predicts anything. Sleep loss impairs physical
          performance on average (−7.6% across 69 studies, Craven 2022), but maximal strength is one of the more robust qualities, so a single bad night
          usually isn&apos;t visible in a lift. Resting heart rate and HRV track training status in <em>endurance</em> athletes — there&apos;s no comparable
          evidence for lifting.
        </p>
        <p>Weeks with fewer than 4 nights/days of data are left blank rather than estimated. Use this to spot patterns worth investigating yourself — not as a readiness signal.</p>
      </ChartNote>
    </ChartCard>
  )
}
