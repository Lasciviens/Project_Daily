import { useMemo } from 'react'
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, ReferenceLine } from 'recharts'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { useAthleteProfile } from '../hooks/useAthleteProfile'
import { computeConsistencyByWeek, currentStreakWeeks } from '../progressAggregate'
import { fmtWeekRange } from '../dateFormat'

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

  const { weeks, streak } = useMemo(() => {
    if (!data) return { weeks: [], streak: 0 }
    const weeks = computeConsistencyByWeek(data.sets)
    return { weeks, streak: currentStreakWeeks(weeks, 1) }
  }, [data])

  if (isLoading) return <div className="h-24 rounded-2xl bg-cream-200 animate-pulse" />
  if (weeks.length === 0) {
    return (
      <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300 mb-2">📅 Training Consistency</p>
        <p className="text-xs text-ink-300 py-6 text-center">No logged sessions in the last 6 months yet.</p>
      </div>
    )
  }

  const last12 = weeks.slice(-12)
  const weeksWith2Plus = last12.filter(w => w.sessionCount >= 2).length
  const target = profile?.training_days_per_week ?? null
  const chartData = weeks.slice(-16).map(w => ({ label: fmtWeek(w.weekStart), weekStart: w.weekStart, sessions: w.sessionCount }))

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">📅 Training Consistency</p>
        <div className="flex items-center gap-3 text-xs text-ink-600">
          <span><strong className="text-ink-900">{streak}</strong> week{streak === 1 ? '' : 's'} streak</span>
          <span><strong className="text-ink-900">{weeksWith2Plus}</strong>/{last12.length} weeks ≥2 sessions</span>
        </div>
      </div>

      <div style={{ height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
            <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={20} allowDecimals={false} domain={[0, 'auto']} />
            <Tooltip
              cursor={{ fill: 'rgb(var(--ink-100))' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts formatter's props type is awkward to import cleanly.
              formatter={(v: any) => [`${v} session${v === 1 ? '' : 's'}`, 'That week']}
              // A single date ("3 Aug") is ambiguous for a WEEKLY bar — real
              // user confusion (2026-09-01) asked for the week's own
              // Mon-Sun range instead.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts labelFormatter's props type is awkward to import cleanly.
              labelFormatter={(_label: any, payload: any) => { const ws = payload?.[0]?.payload?.weekStart; return ws ? fmtWeekRange(ws) : _label }}
              contentStyle={{ fontSize: 11, borderRadius: 8 }}
            />
            {target != null && (
              <ReferenceLine y={target} stroke="rgb(var(--ink-400))" strokeDasharray="4 3" label={{ value: `Your target: ${target}/wk`, position: 'insideTopRight', fontSize: 9, fill: 'rgb(var(--ink-400))' }} />
            )}
            <Bar dataKey="sessions" fill="#f59e0b" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-ink-400">
        Consistency is a precondition for volume adding up over time, not a claim that more sessions itself drives gains
        — training frequency alone showed no benefit at equal weekly volume.
        {target == null && ' Set a weekly training-days target in Training → Coach → Profile to see it plotted here.'}
      </p>
    </div>
  )
}
