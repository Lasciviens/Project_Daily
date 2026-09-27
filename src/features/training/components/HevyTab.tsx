import { useState } from 'react'
import { SegmentedControl } from '../../../shared/ui'
import { PRsSubTab } from './HevyPRList'
import { RoutinesTab } from './RoutinesTab'
import { ExerciseTemplatesTab } from './ExerciseTemplatesTab'

// The Training page's Library tab (this file used to hold the seven-way Hevy
// sub-tab strip; workouts moved to Log, progress and muscles to Progress,
// body measurements to Log → Body). What stays is reference material you
// browse or edit: the exercise catalogue (with the GIF fixer), the routine
// editor, and personal records.

type LibraryView = 'exercises' | 'routines' | 'records'

const VIEWS: { value: LibraryView; label: string }[] = [
  { value: 'routines',  label: 'Routines' },
  { value: 'exercises', label: 'Exercises' },
  { value: 'records',   label: 'Records' },
]

export function LibraryTab() {
  const [view, setView] = useState<LibraryView>('routines')
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <SegmentedControl<LibraryView> size="sm" value={view} onChange={setView} options={VIEWS} />
      {view === 'routines' && <RoutinesTab />}
      {view === 'exercises' && <ExerciseTemplatesTab />}
      {view === 'records' && <PRsSubTab />}
    </div>
  )
}
