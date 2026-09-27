import { formatSleepHours as fmtHrs, sleepStageShares, type SleepSummary } from '../healthAggregate'
import { SLEEP_STAGES } from './sleepStages'

// Each stage as a share of the time in the sleep window (asleep + awake), so
// the bar sums to 100% and the Awake segment is no longer clipped (H-05).
export function SleepStageBar({ night, averaged }: { night: SleepSummary; averaged: boolean }) {
  const shares = sleepStageShares(night)
  const byKey = new Map(shares.map(s => [s.key, s]))
  return (
    <>
      <p className="section-label">Sleep stages{averaged && ' · average per night'}</p>
      <div className="flex h-4 w-full max-w-3xl overflow-hidden rounded-full bg-surface-2" role="img"
        aria-label={shares.filter(s => s.pct > 0).map(s => `${SLEEP_STAGES.find(x => x.key === s.key)?.label} ${Math.round(s.pct)}%`).join(', ')}>
        {SLEEP_STAGES.map(st => {
          const s = byKey.get(st.key)
          return s && s.pct > 0
            ? <div key={st.key} style={{ width: `${s.pct}%`, backgroundColor: st.color }} title={`${st.label}: ${fmtHrs(s.hours)} (${Math.round(s.pct)}%)`} />
            : null
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {SLEEP_STAGES.filter(st => st.key !== 'unstaged' || (byKey.get('unstaged')?.hours ?? 0) > 0).map(st => {
          const s = byKey.get(st.key)
          return (
            <div key={st.key} className="flex items-center gap-1.5 text-meta">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: st.color }} />
              <span className="text-fg-muted">{st.label}</span>
              <span className="font-semibold tabular-nums text-fg">{fmtHrs(s?.hours ?? 0)}</span>
              {s && s.pct > 0 && <span className="tabular-nums text-fg-faint">{Math.round(s.pct)}%</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}
