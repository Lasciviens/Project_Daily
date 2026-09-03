import { useState } from 'react'
import { ExerciseProgressChart } from './ExerciseProgressChart'
import { WeeklyVolumeChart } from './WeeklyVolumeChart'
import { TrainingConsistencyCalendar } from './TrainingConsistencyCalendar'
import { RelativeStrengthChart } from './RelativeStrengthChart'
import { RepRangeDistributionChart } from './RepRangeDistributionChart'
import { WeeklySetsPerMuscleChart } from './WeeklySetsPerMuscleChart'
import { WeeklyChangesPanel } from './WeeklyChangesPanel'
import { RecoveryLoadPanel } from './RecoveryLoadPanel'
import { TrainingInsightsPanel } from './TrainingInsightsPanel'
import { ProgressOverview } from '../progress/ProgressOverview'
import { ExerciseDecisionTable } from '../progress/ExerciseDecisionTable'

// New Hevy sub-tab (2026-08-28, strength-coach + sports-scientist agent
// review): progress/history charts, distinct from Personal Records (all-time
// best single set) and Muscles (a muscle's current weekly training dose).
//
// Follow-up review (2026-08-31) implemented all three originally-deferred
// items plus each agent's own top "extra" recommendation:
//  - RelativeStrengthChart  — bodyweight-normalized strength trend
//  - RepRangeDistributionChart — set-count histogram by rep bucket
//  - RecoveryLoadPanel      — sleep/resting-HR alongside tonnage (3 stacked
//    lanes, never a dual-axis overlay or a computed score)
//  - WeeklySetsPerMuscleChart — sports-scientist's top pick: the Muscles
//    tab's own dose-response currency (sets/muscle/week vs MEV-MAV), as a
//    trend rather than a single rolling-window snapshot
//  - WeeklyChangesPanel     — strength-coach's mechanical replacement for an
//    acute:chronic workload ratio, which the review explicitly advised
//    against (see that file's header comment for why)
//
// Deliberately still NOT built, and why:
//  - An HRV lane on RecoveryLoadPanel — different HRV measures (e.g. SDNN vs
//    RMSSD) must never share a line/average, and this app's own house rule
//    is to verify an external field shape live before shipping copy that
//    names it — add it once that's confirmed against a real payload, not
//    before.
//  - A "Stalled & Progressing" exercise roll-up table (strength-coach's other
//    suggestion) — real value, but a genuinely new UI surface (a sortable
//    table + an OLS-slope helper) rather than an extension of what's here;
//    tracked as a fast-follow, not silently dropped.
//
// Second follow-up (2026-09-01, sports-scientist review): TrainingInsightsPanel
// ("Training Analysis") — a written, deterministic answer to "what am I doing
// well/poorly, what could I do better", placed FIRST so it's read before the
// charts it summarizes. Explicitly a fixed rules engine, not an AI call — see
// trainingInsights.ts's header comment for why a standing analytical view
// needs reproducibility an LLM can't guarantee, unlike PT Coach's dated
// one-shot opinion.
// Third follow-up (2026-09-02, user + a second independent review round —
// see docs/progress-redesign/PLAN.md, delete once this settles and
// CLAUDE.md documents the final architecture): the actual decision engine.
// Everything above this point was descriptive ("here's what happened");
// ProgressOverview/ExerciseDecisionTable are prescriptive ("here's the
// decision, and why") — per the redesign's own visual hierarchy, decisions
// go FIRST, supporting charts move into "More detail" below.
// TrainingInsightsPanel's written analysis and every existing chart are
// kept, not replaced — they're real evidence, just no longer the headline.
//
// Fourth round (progress-engine rewrite, approved algorithm-review cycle):
// Weekly Muscle Dose (MuscleDoseSummary) is REMOVED from this page —
// superseded by the per-exercise decision engine above and never carried
// real dose-vs-landmark evidence of its own beyond what WeeklySetsPerMuscleChart
// (still in the collapsed "supporting charts" section below) already shows.
// Only this card and its now-orphaned Progress-specific calculation code
// (MuscleDoseCard, computeCurrentWeekMuscleDose) were removed — muscleMap.ts
// and every other muscle-mapping consumer (Muscles tab, WeeklySetsPerMuscleChart,
// TrainingInsightsPanel) are untouched.
export function ProgressTab() {
  const [showMore, setShowMore] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <ProgressOverview />
      <ExerciseDecisionTable />

      <button
        type="button"
        onClick={() => setShowMore(v => !v)}
        className="self-start min-h-[44px] px-3 text-xs font-semibold text-ink-500 hover:text-ink-800 flex items-center gap-1.5"
      >
        {showMore ? '▲ Hide supporting charts' : '▼ Show supporting charts & analysis'}
      </button>

      {showMore && (
        <div className="flex flex-col gap-3">
          <TrainingInsightsPanel />
          <ExerciseProgressChart />
          <RelativeStrengthChart />
          <WeeklyVolumeChart />
          <WeeklySetsPerMuscleChart />
          <RepRangeDistributionChart />
          <TrainingConsistencyCalendar />
          <WeeklyChangesPanel />
          <RecoveryLoadPanel />
        </div>
      )}
    </div>
  )
}
