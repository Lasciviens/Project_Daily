import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { PageBoard } from '../../../shared/ui'
import { RESULTS_BOARD } from '../trainingBoards'
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
import { ExerciseList } from '../progress/ExerciseList'
import { useProgressDataContext } from '../progress/progressDataContext'
import { ImprovementCard } from './improve/ImprovementCard'
import { MuscleRecencyList } from './improve/MuscleRecencyList'
import { MuscleWatchLine } from '../../health/goal/MuscleWatchCard'
import { MainLiftsCard } from './results/MainLiftsCard'
import { WeeklySetsCard } from './results/WeeklySetsCard'
import { ConsistencyCard } from './results/ConsistencyCard'

// The Results tab (was Progress; owner, 27.11.2026: "make this page more understandable … Scientific results but not
// confusing!" and "My results, what they are how they are"): three plain cards — main lifts, weekly sets per muscle,
// consistency — then one exercise list grouped by the next step. Everything that was here before stays one tap away:
// each lift's chart and the body map inside their cards, an exercise's explanation, evidence and chart in its row, and
// the program verdict, the all-lifts summary, days since each muscle and the supporting charts under "More details".
// The engine runs once for the page (TrainingProgressProvider) and is read here through ProgressDataContext; the
// cards' numbers are plan/results.ts (verify-training-results). Settled engine rules: docs/training/progress-engine/.
//
// Deliberately NOT built:
//  - An HRV lane on RecoveryLoadPanel — different HRV measures (SDNN vs RMSSD)
//    must never share a line, and the field shape isn't verified live yet.
//  - An acute:chronic workload ratio — see WeeklyChangesPanel's header.

function Disclosure({ label, openLabel, tip, children }: { label: string; openLabel: string; tip: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} title={tip} className="btn-ghost btn-sm gap-1.5 self-start text-meta">
        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? openLabel : label}
      </button>
      {open && children}
    </>
  )
}

export function ResultsTab() {
  const { needsCurrentProgram } = useProgressDataContext()
  // Placed by PageBoard (trainingBoards.ts → RESULTS_BOARD): the three cards and the exercise list, then the details.
  return (
    <PageBoard layout={RESULTS_BOARD} stackGap="gap-3 sm:gap-4" sections={{
      // Without a current program the verdict card asks for one first (its gating card).
      watch: <><MuscleWatchLine />{needsCurrentProgram && <ProgressOverview />}</>,
      lifts: <MainLiftsCard />,
      sets: <WeeklySetsCard />,
      consistency: <ConsistencyCard />,
      exercises: <ExerciseList />,
      more: (
        <div className="flex flex-col gap-3 sm:gap-4">
          <Disclosure label="More details" openLabel="Hide details" tip="More details: the program verdict, all lifts, days since each muscle and the supporting charts">
            {/* Columns by the band's own width: one on a phone, two on a laptop, three on a monitor. */}
            <div className="@container">
              <div className="grid items-start gap-3 sm:gap-4 @[60rem]:grid-cols-2 @[110rem]:grid-cols-3 [&>*]:min-w-0">
                {!needsCurrentProgram && <ProgressOverview />}
                <ImprovementCard />
                <MuscleRecencyList />
                <div className="col-span-full"><TrainingInsightsPanel /></div>
                <ExerciseProgressChart />
                <RelativeStrengthChart />
                <WeeklyVolumeChart />
                <WeeklySetsPerMuscleChart />
                <RepRangeDistributionChart />
                <TrainingConsistencyCalendar />
                <WeeklyChangesPanel />
                <RecoveryLoadPanel />
              </div>
            </div>
          </Disclosure>
        </div>
      ),
    }} />
  )
}
