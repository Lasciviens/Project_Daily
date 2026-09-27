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
import { ProgressDataContext } from '../progress/progressDataContext'
import { useProgressData } from '../hooks/useProgressData'
import { ChevronDown } from 'lucide-react'

// The Progress sub-tab: decisions first (ProgressOverview → ExerciseDecisionTable,
// both reading the progress engine in progress-engine/), supporting charts and
// the written Training Analysis behind a toggle. The settled engine rules live
// in docs/training/progress-engine/.
//
// The engine runs ONCE here and is shared through ProgressDataContext — the
// overview, the gating card, the table and Training Analysis each used to call
// useProgressData() and re-run it for every exercise.
//
// Deliberately NOT built:
//  - An HRV lane on RecoveryLoadPanel — different HRV measures (SDNN vs RMSSD)
//    must never share a line, and the field shape isn't verified live yet.
//  - An acute:chronic workload ratio — see WeeklyChangesPanel's header.
export function ProgressTab() {
  const [showMore, setShowMore] = useState(false)
  const data = useProgressData()
  return (
    <ProgressDataContext.Provider value={data}>
      <div className="flex flex-col gap-3 sm:gap-4">
        <ProgressOverview />
        <ExerciseDecisionTable />

        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          aria-expanded={showMore}
          className="btn-ghost btn-sm gap-1.5 self-start text-meta"
        >
          <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
          {showMore ? 'Hide supporting charts' : 'Show supporting charts & analysis'}
        </button>

        {/* One column up to 2xl; two chart columns on a wide monitor. */}
        {showMore && (
          <div className="grid items-start gap-3 sm:gap-4 2xl:grid-cols-2">
            <div className="2xl:col-span-2"><TrainingInsightsPanel /></div>
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
    </ProgressDataContext.Provider>
  )
}
