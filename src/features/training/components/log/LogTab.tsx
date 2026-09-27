import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, SegmentedControl } from '../../../../shared/ui'
import { HevyWorkoutsList } from '../HevyWorkoutsList'
import { TrainingCalendar } from '../TrainingCalendar'
import { StravaTab } from '../StravaTab'
import { BodyMeasurementsTab } from '../BodyMeasurementsTab'
import { LogHevyWorkoutModal } from '../LogHevyWorkoutModal'

type LogView = 'workouts' | 'strava' | 'body'

const VIEWS: { value: LogView; label: string }[] = [
  { value: 'workouts', label: 'Workouts' },
  { value: 'strava',   label: 'Strava' },
  { value: 'body',     label: 'Body' },
]

/** Log: what you actually did — Hevy workouts with the calendar, Strava
 *  activities (labelled by the service, not "cardio": it holds walks, rides
 *  and anything else Strava records), and body measurements, behind one filter. */
export function LogTab() {
  const [view, setView] = useState<LogView>('workouts')
  const [logOpen, setLogOpen] = useState(false)
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<LogView> size="sm" value={view} onChange={setView} options={VIEWS} />
        {view === 'workouts' && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setLogOpen(true)}>Log workout</Button>}
      </div>

      {view === 'workouts' && (
        // Calendar beside the list on a wide screen, under it on a phone.
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 xl:max-w-[46rem] xl:flex-1"><HevyWorkoutsList /></div>
          <aside className="w-full max-w-[440px] xl:w-[440px] xl:shrink-0"><TrainingCalendar /></aside>
        </div>
      )}
      {view === 'strava' && <StravaTab />}
      {view === 'body' && <BodyMeasurementsTab />}

      <LogHevyWorkoutModal isOpen={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  )
}
