import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { usePrograms, useProgramWorkouts, useProgramExercises } from '../hooks/usePrograms'
import type { Exercise } from '../types'

interface Props {
  onLoad:  (exercises: Exercise[]) => void
  onClose: () => void
}

function WorkoutDayPicker({
  programId,
  onLoad,
}: {
  programId: string
  onLoad:    (exercises: Exercise[]) => void
}) {
  const { data: workouts = [] } = useProgramWorkouts(programId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: exercises = [] }    = useProgramExercises(selectedId ?? undefined)

  function handleLoad() {
    if (!exercises.length) return
    const loaded: Exercise[] = exercises.map(ex => ({
      name: ex.exercise_name,
      sets: Array.from({ length: ex.sets }, () => ({
        reps:      ex.max_reps ?? ex.min_reps ?? undefined,
        weight_kg: undefined,
      })),
    }))
    onLoad(loaded)
  }

  return (
    <div className="space-y-2">
      {workouts.map(w => (
        <button
          key={w.id}
          onClick={() => setSelectedId(id => id === w.id ? null : w.id)}
          className={`w-full text-left px-4 py-3 rounded-xl border transition-colors duration-150 min-h-[44px] ${
            selectedId === w.id
              ? 'border-accent-400 bg-accent-50 text-accent-700'
              : 'border-ink-100 hover:border-ink-300 text-ink-700'
          }`}
        >
          <span className="text-sm font-medium">{w.name}</span>
        </button>
      ))}

      {selectedId && exercises.length > 0 && (
        <div className="mt-2 px-4 py-3 bg-cream-50 rounded-xl space-y-1.5">
          {exercises.map((ex, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-ink-700">{ex.exercise_name}</span>
              <span className="text-xs text-ink-400">
                {ex.sets} × {ex.min_reps ?? '?'}
                {ex.max_reps && ex.max_reps !== ex.min_reps ? `–${ex.max_reps}` : ''} reps
              </span>
            </div>
          ))}
          <button
            onClick={handleLoad}
            className="w-full mt-2 py-2.5 bg-accent-500 text-white text-sm rounded-lg hover:bg-accent-600 transition-colors duration-150 font-medium min-h-[44px]"
          >
            Load this workout
          </button>
        </div>
      )}
    </div>
  )
}

export function ProgramPickerDialog({ onLoad, onClose }: Props) {
  const { data: programs = [], isLoading } = usePrograms()
  const [programId, setProgramId]          = useState<string | null>(null)

  function handleLoad(exercises: Exercise[]) {
    onLoad(exercises)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-md max-h-[80vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="px-5 pt-5 pb-3 border-b border-ink-100 flex items-center justify-between sticky top-0 bg-white">
            <h2 className="text-base font-semibold text-ink-900">Load from program</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-600 text-lg">×</button>
          </div>

          <div className="p-5 space-y-3">
            {isLoading && <p className="text-sm text-ink-400">Loading…</p>}

            {!isLoading && programs.length === 0 && (
              <p className="text-sm text-ink-400 text-center py-6">
                No programs yet. Create one in the Programs tab.
              </p>
            )}

            {programs.map(p => (
              <div key={p.id}>
                <button
                  onClick={() => setProgramId(id => id === p.id ? null : p.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors duration-150 min-h-[44px] ${
                    programId === p.id
                      ? 'border-accent-400 bg-accent-50'
                      : 'border-ink-200 hover:border-ink-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-ink-900">{p.name}</p>
                  {p.description && <p className="text-xs text-ink-400 mt-0.5">{p.description}</p>}
                </button>
                {programId === p.id && (
                  <div className="mt-2 pl-2">
                    <WorkoutDayPicker programId={p.id} onLoad={handleLoad} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
