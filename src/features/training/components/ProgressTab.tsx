import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { PageBoard } from '../../../shared/ui'
import { PROGRESS_BOARD } from '../trainingBoards'
import { ExerciseProgressChart } from './ExerciseProgressChart'
import { WeeklyVolumeChart } from './WeeklyVolumeChart'
import { TrainingConsistencyCalendar } from './TrainingConsistencyCalendar'
import { RelativeStrengthChart } from './RelativeStrengthChart'
import { RepRangeDistributionChart } from './RepRangeDistributionChart'
import { WeeklySetsPerMuscleChart } from './WeeklySetsPerMuscleChart'
import { WeeklyChangesPanel } from './WeeklyChangesPanel'
import { RecoveryLoadPanel } from './RecoveryLoadPanel'
import { TrainingInsightsPanel } from './TrainingInsightsPanel'
import { WorkedMuscles } from './WorkedMuscles'
import { ProgressOverview } from '../progress/ProgressOverview'
import { ExerciseDecisionTable } from '../progress/ExerciseDecisionTable'
import { useProgressDataContext } from '../progress/progressDataContext'
import { ImprovementCard } from './improve/ImprovementCard'
import { MuscleRecencyList } from './improve/MuscleRecencyList'

// The Progress tab, top to bottom: the window's improvement summary (lifts
// improved, main-lift e1RM change, bodyweight) → the
// engine's program verdict and per-exercise decisions → the weekly-volume
// body map (open by default — its colours are the point) → days since each
// muscle was trained (a list) → the supporting charts behind a toggle. The engine runs once for the page (TrainingProgressProvider)
// and is read here through ProgressDataContext. Settled engine rules:
// docs/training/progress-engine/.
//
// Deliberately NOT built:
//  - An HRV lane on RecoveryLoadPanel — different HRV measures (SDNN vs RMSSD)
//    must never share a line, and the field shape isn't verified live yet.
//  - An acute:chronic workload ratio — see WeeklyChangesPanel's header.

function Disclosure({ label, openLabel, children }: { label: string; openLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="btn-ghost btn-sm gap-1.5 self-start text-meta">
        <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? openLabel : label}
      </button>
      {open && children}
    </>
  )
}

export function ProgressTab() {
  const { routineTitlesByTemplateId } = useProgressDataContext()
  const preferIds = useMemo(() => new Set(routineTitlesByTemplateId.keys()), [routineTitlesByTemplateId])
  // Placed by PageBoard (trainingBoards.ts → PROGRESS_BOARD): decisions and
  // the body map in main, the summaries in a rail, the charts underneath.
  return (
    <PageBoard layout={PROGRESS_BOARD} stackGap="gap-3 sm:gap-4" sections={{
      improvement: <ImprovementCard preferIds={preferIds} />,
      overview: <ProgressOverview />,
      decisions: <ExerciseDecisionTable />,
      muscles: <WorkedMuscles />,
      recency: <MuscleRecencyList />,
      charts: (
        <div className="flex flex-col gap-3 sm:gap-4">
          <Disclosure label="Show supporting charts & analysis" openLabel="Hide supporting charts">
            {/* Columns by the band's own width: one on a phone, two on a laptop, three on a monitor. */}
            <div className="@container">
              <div className="grid items-start gap-3 sm:gap-4 @[60rem]:grid-cols-2 @[110rem]:grid-cols-3">
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
