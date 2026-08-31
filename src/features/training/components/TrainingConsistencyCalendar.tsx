import { useMemo } from 'react'
import { useTrainingHistory } from '../hooks/useTrainingProgress'
import { computeConsistencyByWeek, currentStreakWeeks } from '../progressAggregate'

// Session-count-per-week heatmap — a sports-scientist review's #2-priority
// chart, and deliberately the cheapest/least speculative one: it's a direct
// count of a real event (a logged workout), not a derived construct. Every
// volume/frequency finding this app's Muscles feature already leans on
// (Schoenfeld/Ogborn/Krieger 2017 dose-response; Schoenfeld/Grgic/Krieger
// 2019 on frequency) presumes the sets actually got trained — this is the
// precondition check for that, not a claim that MORE sessions itself drives
// gains (frequency was null at equated volume in that 2019 finding).

function fmtWeek(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Diverging by session count, not a single "did/didn't train" binary — a
// 4-session week reads differently from a 1-session week at a glance.
function cellClass(count: number): string {
  if (count === 0) return 'bg-ink-100'
  if (count === 1) return 'bg-accent-200'
  if (count === 2) return 'bg-accent-400'
  if (count === 3) return 'bg-accent-600'
  return 'bg-accent-800'
}

export function TrainingConsistencyCalendar() {
  const { data, isLoading } = useTrainingHistory()

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

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-3 sm:p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">📅 Training Consistency</p>
        <div className="flex items-center gap-3 text-xs text-ink-600">
          <span><strong className="text-ink-900">{streak}</strong> week{streak === 1 ? '' : 's'} streak</span>
          <span><strong className="text-ink-900">{weeksWith2Plus}</strong>/{last12.length} weeks ≥2 sessions</span>
        </div>
      </div>

      {/* One column per week, one cell — session-count is the fill depth, not
          a permanent day-grid, since Hevy doesn't need per-day resolution here. */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.slice(-26).map(w => (
          <div key={w.weekStart} className="flex flex-col items-center gap-1 shrink-0" title={`${fmtWeek(w.weekStart)}: ${w.sessionCount} session${w.sessionCount === 1 ? '' : 's'}`}>
            <div className={`w-4 h-4 rounded ${cellClass(w.sessionCount)}`} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
        <span>Fewer</span>
        {[0, 1, 2, 3, 4].map(n => <div key={n} className={`w-3 h-3 rounded ${cellClass(n)}`} />)}
        <span>More sessions/week</span>
      </div>
      <p className="text-[11px] text-ink-400">
        Consistency is a precondition for volume adding up over time, not a claim that more sessions itself drives gains
        — training frequency alone showed no benefit at equal weekly volume.
      </p>
    </div>
  )
}
