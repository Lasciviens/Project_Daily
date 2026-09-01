import { useMemo } from 'react'
import { Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeWeeklyVolumeTrend, rollingAverage } from '../progressAggregate'
import { lastCompleteWeek } from '../trainingInsights'
import { compactAxisTick } from './health/axisFormat'

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
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; only a few fields are read.
function VolumeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-cream-50 border border-ink-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs space-y-0.5">
      <p className="text-ink-400 font-medium">{label}</p>
      {payload.map((p: { dataKey: string; value: number; color: string }) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.value.toLocaleString('en-GB')} kg {p.dataKey === 'avg4wk' ? '· 4-week avg' : '· that week'}
        </p>
      ))}
    </div>
  )
}

export function WeeklyVolumeChart() {
  const { data, isLoading } = useTrainingHistory()

  const chartData = useMemo(() => {
    if (!data) return []
    // The current, still-in-progress week is excluded — plotted alongside
    // finished weeks it always reads as a cliff (sports-scientist review,
    // 2026-09-01: this is the exact partial-week bug trainingInsights.ts
    // already guards against; the chart hadn't).
    const last = lastCompleteWeek(new Date().toISOString().slice(0, 10))
    const weeks = computeWeeklyVolumeTrend(data.sets, data.templates).filter(w => w.weekStart <= last)
    const avg = rollingAverage(weeks, 4)
    return weeks.map((w, i) => ({ label: fmtWeek(w.weekStart), tonnage: w.tonnageKg, avg4wk: avg[i] ?? undefined }))
  }, [data])

  if (isLoading) return <div className="h-40 rounded-2xl bg-cream-200 animate-pulse" />
  if (chartData.length === 0) {
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300 mb-2">🏋️ Weekly Training Volume</p>
        <p className="text-xs text-ink-300 py-6 text-center">No weight-based sets logged in the last 6 months yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">🏋️ Weekly Training Volume</p>
      <div style={{ height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={38} tickFormatter={compactAxisTick} />
            <Tooltip cursor={false} content={VolumeTooltip} />
            <Bar dataKey="tonnage" name="Weekly volume" fill="#7c3aed" fillOpacity={0.3} radius={[3, 3, 0, 0]} barSize={12} />
            <Line dataKey="avg4wk" name="4-week avg" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-ink-400">
        Total weight lifted per week (Σ weight × reps, warm-ups excluded), with a 4-week rolling average. This is a training <em>input</em>, not a
        stimulus or outcome — it conflates load and reps freely (100kg×5 and 50kg×10 tally the same) and shifts when your exercise mix changes.
        Read the trend over months, not week to week.
      </p>
    </div>
  )
}
