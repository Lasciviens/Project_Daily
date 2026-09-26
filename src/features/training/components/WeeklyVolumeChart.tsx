import { useMemo } from 'react'
import { Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeWeeklyVolumeTrend, rollingAverage } from '../progressAggregate'
import { lastCompleteWeek } from '../trainingInsights'
import { fmtWeekRange } from '../dateFormat'
import { compactAxisTick } from './health/axisFormat'
import { Skeleton, useChartColors } from '../../../shared/ui'
import { TOOLTIP_BOX } from './chartKit'
import { ChartCard, ChartEmpty, ChartNote } from './ChartCard'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

// Weekly total tonnage (Σ weight×reps, warm-ups excluded, weight-based
// exercise types only) with a 4-week rolling average — a strength-coach +
// sports-scientist review's #1-priority chart: the most direct visualization
// of the volume trend already anchoring the Muscles feature's landmarks, but
// as a TREND rather than a current-window snapshot. Tonnage is a training
// INPUT, not a stimulus or outcome — see the guardrail line below. Uses its
// own ComposedChart (not the shared BarLineChart) because it needs TWO
// distinct series — weekly bars + a separate rolling-average line — which
// BarLineChart's one-dataKey-shared-by-bar-and-line shape doesn't support.

function fmtWeek(dateStr: string): string {
  return fmtDateEnGB(new Date(dateStr + 'T00:00:00'), { day: 'numeric', month: 'short' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; only a few fields are read.
function VolumeTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const weekStart = payload[0]?.payload?.weekStart
  return (
    <div className={TOOLTIP_BOX}>
      {/* A single date is ambiguous for a WEEKLY value — is it the start, the
          end, the day it was logged? Always show the full Mon-Sun range. */}
      <p className="font-medium text-fg-muted">{weekStart ? fmtWeekRange(weekStart) : ''}</p>
      {payload.map((p: { dataKey: string; value: number; color: string }) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.dataKey === 'avg4wk' ? '4-week rolling average: ' : 'That week: '}{p.value.toLocaleString('en-GB')} kg
        </p>
      ))}
    </div>
  )
}

export function WeeklyVolumeChart() {
  const { data, isLoading } = useTrainingHistory()
  const c = useChartColors()

  const chartData = useMemo(() => {
    if (!data) return []
    // The current, still-in-progress week is excluded — plotted alongside
    // finished weeks it always reads as a cliff (sports-scientist review,
    // 2026-09-01: this is the exact partial-week bug trainingInsights.ts
    // already guards against; the chart hadn't).
    const last = lastCompleteWeek(new Date().toISOString().slice(0, 10))
    const weeks = computeWeeklyVolumeTrend(data.sets, data.templates).filter(w => w.weekStart <= last)
    const avg = rollingAverage(weeks, 4)
    return weeks.map((w, i) => ({ label: fmtWeek(w.weekStart), weekStart: w.weekStart, tonnage: w.tonnageKg, avg4wk: avg[i] ?? undefined }))
  }, [data])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-40" />
  if (chartData.length === 0) {
    return (
      <ChartCard title="Weekly training volume">
        <ChartEmpty>No weight-based sets logged in the last 6 months yet.</ChartEmpty>
      </ChartCard>
    )
  }

  return (
    <ChartCard title="Weekly training volume">
      <div style={{ height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
            <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} />
            <Tooltip cursor={false} content={VolumeTooltip} />
            <Bar dataKey="tonnage" name="Weekly volume" fill={c.series[1]} fillOpacity={0.3} radius={[3, 3, 0, 0]} barSize={12} />
            <Line dataKey="avg4wk" name="4-week avg" stroke={c.series[1]} strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartNote>
        Total weight lifted per week (Σ weight × reps, warm-ups excluded), with a 4-week rolling average. This is a training <em>input</em>, not a
        stimulus or outcome — it conflates load and reps freely (100kg×5 and 50kg×10 tally the same) and shifts when your exercise mix changes.
        Read the trend over months, not week to week.
      </ChartNote>
    </ChartCard>
  )
}
