import { useState } from 'react'
import { toast } from '../../../app/store'
import {
  usePrograms, useCreateProgram, useDeleteProgram,
  useProgramWorkouts, useCreateProgramWorkout, useDeleteProgramWorkout,
  useProgramExercises,
} from '../hooks/usePrograms'
import { EditWorkoutModal } from './EditWorkoutModal'
import type { TrainingProgram, ProgramWorkout } from '../types'

// ── Workout day row ───────────────────────────────────────────────────────────

function WorkoutRow({
  workout,
  programId,
}: {
  workout:   ProgramWorkout
  programId: string
}) {
  const [open,        setOpen]        = useState(false)
  const [showEdit,    setShowEdit]    = useState(false)
  const { data: exercises = [] }      = useProgramExercises(open ? workout.id : undefined)
  const del = useDeleteProgramWorkout()

  async function handleDelete() {
    if (!confirm(`Delete "${workout.name}"?`)) return
    const tid = toast.loading('Deleting…')
    try {
      await del.mutateAsync({ id: workout.id, programId })
      toast.dismiss(tid); toast.success('Deleted')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  return (
    <>
      <div className="rounded-xl border-2 border-ink-100 overflow-hidden bg-white">
        {/* Day header row */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left min-h-[52px] hover:bg-cream-50 transition-colors duration-150"
        >
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${open ? 'bg-accent-500' : 'bg-ink-200'}`} />
          <span className="flex-1 text-sm font-semibold text-ink-800">{workout.name}</span>
          {exercises.length > 0 && (
            <span className="text-[10px] text-ink-400 font-medium">{exercises.length} exercise{exercises.length !== 1 ? 's' : ''}</span>
          )}
          <span className="text-ink-300 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="border-t-2 border-ink-100 bg-cream-50">
            {/* Exercise list */}
            {exercises.length > 0 ? (
              <div className="divide-y divide-ink-100">
                {exercises.map((ex, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-ink-800 font-medium">{ex.exercise_name}</span>
                    <span className="text-xs text-ink-500 bg-ink-100 px-2 py-0.5 rounded-full ml-3 flex-shrink-0">
                      {ex.sets} × {ex.min_reps ?? '?'}{ex.max_reps && ex.max_reps !== ex.min_reps ? `–${ex.max_reps}` : ''} reps
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-3 text-xs text-ink-400 italic">No exercises yet</p>
            )}

            {/* Action bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-ink-100">
              <button
                onClick={() => setShowEdit(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white bg-accent-500 rounded-lg hover:bg-accent-600 transition-colors duration-150 min-h-[40px]"
              >
                {exercises.length === 0 ? '+ Add exercises' : '✎ Edit exercises'}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-2 text-xs text-ink-400 hover:text-red-500 border border-ink-200 rounded-lg hover:border-red-200 transition-colors duration-150 min-h-[40px]"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {showEdit && (
        <EditWorkoutModal workout={workout} onClose={() => setShowEdit(false)} />
      )}
    </>
  )
}

// ── Program card ──────────────────────────────────────────────────────────────

function ProgramCard({ program }: { program: TrainingProgram }) {
  const [open,    setOpen]    = useState(false)
  const [newDay,  setNewDay]  = useState('')

  const { data: workouts = [] } = useProgramWorkouts(open ? program.id : undefined)
  const createWorkout           = useCreateProgramWorkout()
  const delProgram              = useDeleteProgram()

  async function addDay() {
    if (!newDay.trim()) return
    const tid = toast.loading('Adding…')
    try {
      await createWorkout.mutateAsync({ programId: program.id, name: newDay.trim() })
      setNewDay('')
      toast.dismiss(tid); toast.success('Day added ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  async function handleDeleteProgram() {
    if (!confirm(`Delete program "${program.name}" and all its days?`)) return
    const tid = toast.loading('Deleting…')
    try {
      await delProgram.mutateAsync(program.id)
      toast.dismiss(tid); toast.success('Deleted')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition-all duration-150 ${
      open ? 'border-accent-400 shadow-md' : 'border-ink-200 shadow-sm hover:border-ink-300'
    } bg-white`}>
      {/* Program header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left min-h-[60px] hover:bg-cream-50 transition-colors duration-150"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
          open ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-500'
        }`}>
          {program.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink-900 truncate">{program.name}</p>
          {program.description && (
            <p className="text-[11px] text-ink-400 truncate mt-0.5">{program.description}</p>
          )}
        </div>
        {workouts.length > 0 && open && (
          <span className="text-[10px] text-ink-400 font-medium flex-shrink-0">
            {workouts.length} day{workouts.length !== 1 ? 's' : ''}
          </span>
        )}
        <span className={`text-xs flex-shrink-0 transition-colors duration-150 ${open ? 'text-accent-500' : 'text-ink-300'}`}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="border-t-2 border-ink-100">
          {/* Workout days */}
          <div className="p-4 space-y-2">
            {workouts.map(w => (
              <WorkoutRow key={w.id} workout={w} programId={program.id} />
            ))}

            {workouts.length === 0 && (
              <p className="text-xs text-ink-400 text-center py-2">No workout days yet — add one below</p>
            )}

            {/* Add workout day */}
            <div className="flex gap-2 pt-1">
              <input
                value={newDay}
                onChange={e => setNewDay(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addDay()}
                placeholder="New day name (e.g. Chest Day)…"
                className="flex-1 border-2 border-ink-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
              />
              <button
                onClick={addDay}
                disabled={!newDay.trim() || createWorkout.isPending}
                className="px-4 text-sm font-semibold bg-ink-800 text-white rounded-xl hover:bg-ink-900 disabled:opacity-40 transition-colors duration-150 min-h-[44px]"
              >
                Add
              </button>
            </div>
          </div>

          {/* Delete program */}
          <div className="px-4 pb-3 border-t border-ink-100 pt-2">
            <button
              onClick={handleDeleteProgram}
              className="text-[11px] text-red-400 hover:text-red-600 min-h-[36px]"
            >
              Delete program
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function ProgramsTab() {
  const { data: programs = [], isLoading } = usePrograms()
  const create = useCreateProgram()
  const [name, setName]         = useState('')
  const [desc, setDesc]         = useState('')
  const [showForm, setShowForm] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    const tid = toast.loading('Creating…')
    try {
      await create.mutateAsync({ name: name.trim(), description: desc.trim() || undefined })
      setName(''); setDesc(''); setShowForm(false)
      toast.dismiss(tid); toast.success('Program created ✓')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-cream-200 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {programs.length === 0 && !showForm && (
        <div className="text-center py-12 border-2 border-dashed border-ink-200 rounded-2xl">
          <p className="text-ink-500 text-sm font-medium mb-1">No programs yet</p>
          <p className="text-ink-300 text-xs">Create a program (e.g. "5 Day Split") then add workout days and exercises.</p>
        </div>
      )}

      {programs.map(p => <ProgramCard key={p.id} program={p} />)}

      {showForm ? (
        <div className="bg-white border-2 border-accent-300 rounded-2xl p-5 space-y-3 shadow-sm">
          <p className="text-sm font-bold text-ink-900">New program</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Program name (e.g. 5 Day Split)"
            autoFocus
            className="w-full border-2 border-ink-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
          />
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full border-2 border-ink-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || create.isPending}
              className="flex-1 btn-primary py-2.5"
            >
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setName(''); setDesc('') }}
              className="px-4 py-2 text-sm text-ink-500 hover:text-ink-700 border-2 border-ink-200 rounded-xl min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3.5 border-2 border-dashed border-ink-200 rounded-2xl text-sm font-semibold text-accent-600 hover:border-accent-300 hover:bg-accent-50 transition-colors duration-150 min-h-[44px]"
        >
          + New program
        </button>
      )}
    </div>
  )
}
