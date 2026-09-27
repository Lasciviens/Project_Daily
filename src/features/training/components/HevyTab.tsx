import { useState } from 'react'
import { SegmentedControl } from '../../../shared/ui'
import { RoutinesTab } from './RoutinesTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'

// The Training page's Library tab (this file used to hold the seven-way Hevy
// sub-tab strip; workouts moved to Log, progress and muscles to Progress,
// body measurements to Log → Body). What stays is reference material you
// browse or edit: the routine editor and the exercise catalogue (with the GIF
// fixer). Personal records were removed on the owner's call.

type LibraryView = 'exercises' | 'routines'

const VIEWS: { value: LibraryView; label: string }[] = [
  { value: 'routines',  label: 'Routines' },
  { value: 'exercises', label: 'Exercises' },
]

export function LibraryTab() {
  const [view, setView] = useState<LibraryView>('routines')
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <SegmentedControl<LibraryView> size="sm" value={view} onChange={setView} options={VIEWS} />
      {view === 'routines' && <RoutinesTab />}
      {view === 'exercises' && <ExerciseTemplatesTab />}
    </div>
  )
}
