import { useMemo } from 'react'
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, ReferenceLine } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { useAthleteProfile } from '../hooks/useAthleteProfile'
import { computeConsistencyByWeek, currentStreakWeeks } from '../progressAggregate'
import { fmtWeekRange } from '../dateFormat'
import { Skeleton, useChartColors } from '../../../shared/ui'
import { useTooltipStyle } from './chartKit'
import { ChartCard, ChartEmpty, ChartNote } from './ChartCard'

// Sessions-per-week — a sports-scientist review's #2-priority chart, and
// deliberately the cheapest/least speculative one: it's a direct count of a
// real event (a logged workout), not a derived construct. Every volume/
// frequency finding this app's Muscles feature already leans on (Schoenfeld/
// Ogborn/Krieger 2017 dose-response; Schoenfeld/Grgic/Krieger 2019 on
// frequency) presumes the sets actually got trained — this is the
// precondition check for that, not a claim that MORE sessions itself drives
// gains (frequency was null at equated volume in that 2019 finding).
//
// A follow-up review (2026-09-01) replaced the original diverging week-cell
// heat-strip with a plain bar chart + a reference line at the user's own
// declared `athlete_profile.training_days_per_week` — a real-app precedent
// search found Strava's own Relative Effort view uses exactly this shape
// (a weekly bar against a target/suggested-range band) rather than a
// GitHub-contribution-style heatmap, and no fitness app was found using a
// heat-strip for this; a bar's HEIGHT is directly readable with zero legend
// lookup, where the old strip needed a fill-depth legend per cell.

function fmtWeek(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function TrainingConsistencyCalendar() {
  const { data, isLoading } = useTrainingHistory()
  const { data: profile } = useAthleteProfile()
  const c = useChartColors()
  const tip = useTooltipStyle()

  const { weeks, streak } = useMemo(() => {
    if (!data) return { weeks: [], streak: 0 }
    const weeks = computeConsistencyByWeek(data.sets)
    return { weeks, streak: currentStreakWeeks(weeks, 1) }
  }, [data])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-24" />
  if (weeks.length === 0) {
    return (
      <ChartCard title="Training consistency">
        <ChartEmpty>No logged sessions in the last 6 months yet.</ChartEmpty>
      </ChartCard>
    )
  }

  const last12 = weeks.slice(-12)
  const weeksWith2Plus = last12.filter(w => w.sessionCount >= 2).length
  const target = profile?.training_days_per_week ?? null
  const chartData = weeks.slice(-16).map(w => ({ label: fmtWeek(w.weekStart), weekStart: w.weekStart, sessions: w.sessionCount }))

  return (
    <ChartCard title="Training consistency">
      <div className="flex flex-wrap items-center gap-3 text-meta text-fg-2">
        <span><strong className="tabular-nums text-fg">{streak}</strong> week{streak === 1 ? '' : 's'} streak</span>
        <span><strong className="tabular-nums text-fg">{weeksWith2Plus}</strong>/{last12.length} weeks ≥2 sessions</span>
      </div>

      <div style={{ height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
            <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={20} allowDecimals={false} domain={[0, 'auto']} />
            <Tooltip
              cursor={{ fill: c.grid, fillOpacity: 0.5 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
              formatter={(v: any) => [`${v} session${v === 1 ? '' : 's'}`, 'That week']}
              // A single date ("3 Aug") is ambiguous for a WEEKLY bar — real
              // user confusion (2026-09-01) asked for the week's own
              // Mon-Sun range instead.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts labelFormatter's props type is awkward to import cleanly.
              labelFormatter={(_label: any, payload: any) => { const ws = payload?.[0]?.payload?.weekStart; return ws ? fmtWeekRange(ws) : _label }}
              contentStyle={tip.contentStyle}
              labelStyle={tip.labelStyle}
            />
            {target != null && (
              <ReferenceLine y={target} stroke={c.axis} strokeDasharray="4 3" label={{ value: `Your target: ${target}/wk`, position: 'insideTopRight', fontSize: 9, fill: c.axis }} />
            )}
            <Bar dataKey="sessions" fill={c.series[2]} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ChartNote>
        Consistency is a precondition for volume adding up over time, not a claim that more sessions itself drives gains
        — training frequency alone showed no benefit at equal weekly volume.
        {target == null && ' Set a weekly training-days target in Training → Coach → Profile to see it plotted here.'}
      </ChartNote>
    </ChartCard>
  )
}
