import { useState } from 'react'
import { HevyWorkoutsList } from '../HevyWorkoutsList'
import { StravaTab } from '../StravaTab'
import { LogHevyWorkoutModal } from '../LogHevyWorkoutModal'
import { TrainingMonthCalendar } from '../calendar/TrainingMonthCalendar'
import type { LogView } from '../../pages/trainingTabs'

/** Log: what you actually did. Hevy (default) is the month calendar — sticky
 *  on the left from `lg`, on top on a phone — beside the workout cards;
 *  Strava lists its activities (labelled by the service, not "cardio": it
 *  holds walks, rides and anything else Strava records). The view is picked
 *  in the page's tab row (`?view=`). Body measurements live in Health → Body. */
export function LogTab({ view }: { view: LogView }) {
  const [logOpen, setLogOpen] = useState(false)
  if (view === 'strava') return <StravaTab />
  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="w-full max-w-[28rem] lg:sticky lg:top-4 lg:w-[26rem] lg:shrink-0">
          <TrainingMonthCalendar />
        </aside>
        <div className="min-w-0 lg:flex-1">
          <HevyWorkoutsList onLogWorkout={() => setLogOpen(true)} />
        </div>
      </div>
      <LogHevyWorkoutModal isOpen={logOpen} onClose={() => setLogOpen(false)} />
    </>
  )
}
