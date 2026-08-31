import { ExerciseProgressChart } from './ExerciseProgressChart'
import { WeeklyVolumeChart } from './WeeklyVolumeChart'
import { TrainingConsistencyCalendar } from './TrainingConsistencyCalendar'

// New Hevy sub-tab (2026-08-28, strength-coach + sports-scientist agent
// review): progress/history charts, distinct from Personal Records (all-time
// best single set) and Muscles (a muscle's current weekly training dose).
// Deliberately NOT included this pass — the sports-scientist review flagged
// both as needing either more cross-domain plumbing or an unverified-citation
// check before shipping user-facing copy: a sleep/HRV-vs-load overlay (real
// value, but pattern-spotting only — no readiness score, no threshold line,
// no causality claim) and a bodyweight-normalized relative-strength chart
// (a reasonable practitioner proxy, not a measured relationship). Tracked as
// a fast-follow, not silently dropped.
export function ProgressTab() {
  return (
    <div className="flex flex-col gap-3">
      <ExerciseProgressChart />
      <WeeklyVolumeChart />
      <TrainingConsistencyCalendar />
    </div>
  )
}
