import { useState } from 'react'
import { HevyWorkoutsList } from '../HevyWorkoutsList'
import { StravaTab } from '../StravaTab'
import { LogHevyWorkoutModal } from '../LogHevyWorkoutModal'
import { TrainingMonthCalendar } from '../calendar/TrainingMonthCalendar'
import type { LogView } from '../../pages/trainingTabs'
import { PageBoard } from '../../../../shared/ui'
import { LOG_BOARD } from '../../trainingBoards'

/** Log: what you actually did. Hevy (default) is the month calendar — a
 *  sticky rail on the left on a wide page, on top on a phone — beside the workout cards;
 *  Strava lists its activities (labelled by the service, not "cardio": it
 *  holds walks, rides and anything else Strava records). The view is picked
 *  in the page's tab row (`?view=`). Body measurements live in Health → Body. */
export function LogTab({ view }: { view: LogView }) {
  const [logOpen, setLogOpen] = useState(false)
  if (view === 'strava') return <StravaTab />
  return (
    <>
      {/* Placed by PageBoard (trainingBoards.ts → LOG_BOARD): the calendar a
          sticky rail on the left, the workout cards across the other tracks. */}
      <PageBoard layout={LOG_BOARD} stackGap="gap-4" sections={{
        calendar: <aside className="w-full max-w-[28rem]"><TrainingMonthCalendar /></aside>,
        workouts: <HevyWorkoutsList onLogWorkout={() => setLogOpen(true)} />,
      }} />
      <LogHevyWorkoutModal isOpen={logOpen} onClose={() => setLogOpen(false)} />
    </>
  )
}
