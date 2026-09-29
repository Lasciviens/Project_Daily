import { RoutinesTab } from './RoutinesTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'
import type { LibraryView } from '../pages/trainingTabs'

// The Training page's Library tab (this file used to hold the seven-way Hevy
// sub-tab strip; workouts moved to Log, progress and muscles to Progress,
// body measurements to Health → Body). What stays is reference material you
// browse or edit: the routine editor and the exercise catalogue (with the GIF
// fixer). Routines | Exercises is picked in the page's tab row (`?view=`).
// Personal records were removed on the owner's call.
export function LibraryTab({ view }: { view: LibraryView }) {
  return view === 'exercises' ? <ExerciseTemplatesTab /> : <RoutinesTab />
}
