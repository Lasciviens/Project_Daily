import { Link } from 'react-router-dom'
import { useHealthMetricSeries } from '../../../training/hooks/useHealthExport'
import { computeSleepSummary, extractSleepSessions, computeSleepScore } from '../../../training/healthAggregate'
import { shiftDateStr } from '../../../../shared/utils/dateUtils'

const STAGES = [
  { key: 'deep' as const, label: 'Deep',  color: '#4338ca' },
  { key: 'core' as const, label: 'Core',  color: '#6366f1' },
  { key: 'rem'  as const, label: 'REM',   color: '#a5b4fc' },
  { key: 'awake' as const, label: 'Awake', color: '#f87171' },
]

function fmtHrs(h: number): string {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return `${hrs}h ${mins}m`
}
const fmtClock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-700 border-green-200'
  if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-red-100 text-red-700 border-red-200'
}

// 😴 The night that ENDED on the viewed day, at session granularity (the
// exported data has no per-stage timing — see Health's Sleep section for the
// full view/corrections). Same aggregation code as Health, so the two can
// never disagree.
export function SleepCard({ date }: { date: string }) {
  // Night attribution can place rows on either side of midnight — fetch a
  // 2-day window and pick the summary keyed to the viewed date.
  const { data: points = [] } = useHealthMetricSeries('sleep_analysis', shiftDateStr(date, -1), date)
  const summary = computeSleepSummary(points).find(s => s.date === date) ?? null
  const sessions = summary ? extractSleepSessions(points, date) : []
  const score = summary ? computeSleepScore(summary, Math.max(sessions.length, 1)) : null

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">😴 Sleep</h3>
        <Link to="/training" className="text-[11px] text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 flex items-center">
          Health →
        </Link>
      </div>

      {!summary ? (
        <p className="text-xs text-ink-400 py-1">No sleep data for this night.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-ink-900 leading-none">{fmtHrs(summary.total)}</p>
            {score != null && (
              <span className={`text-[11px] font-bold border rounded-full px-2 py-0.5 ${scoreColor(score)}`}
                title="Estimated score — duration, deep/REM share, interruptions">
                {score} <span className="font-normal opacity-70">est.</span>
              </span>
            )}
          </div>
          {sessions.length > 0 && (
            <p className="text-[11px] text-ink-500 tabular-nums">
              😴 {fmtClock(sessions[0].startMs)} → ⏰ {fmtClock(sessions[sessions.length - 1].endMs)}
              {sessions.length > 1 && (
                <span className="text-amber-600 ml-1.5">
                  · {sessions.length - 1} interruption{sessions.length > 2 ? 's' : ''}
                </span>
              )}
            </p>
          )}
          <div className="h-2.5 rounded-full overflow-hidden flex w-full bg-ink-100">
            {STAGES.map(s => {
              const val = summary[s.key]
              const denom = summary.total + summary.awake
              const pct = denom > 0 ? (val / denom) * 100 : 0
              return pct > 0 ? (
                <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} title={`${s.label}: ${fmtHrs(val)}`} />
              ) : null
            })}
          </div>
          <div className="flex gap-2.5 flex-wrap">
            {STAGES.filter(s => summary[s.key] > 0).map(s => (
              <span key={s.key} className="flex items-center gap-1 text-[10px] text-ink-500">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label} {fmtHrs(summary[s.key])}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
