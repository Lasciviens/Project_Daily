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
  onEdit,
}: {
  workout:   ProgramWorkout
  programId: string
  onEdit:    () => void
}) {
  const [open, setOpen] = useState(false)
  const { data: exercises = [] } = useProgramExercises(open ? workout.id : undefined)
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
    <div className="border border-ink-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left min-h-[44px] hover:bg-cream-50 transition-colors duration-150"
      >
        <span className="text-sm font-medium text-ink-800">{workout.name}</span>
        <span className="text-ink-300 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-ink-100 px-4 py-3 space-y-2 bg-cream-50">
          {exercises.length === 0 ? (
            <p className="text-xs text-ink-400 italic">No exercises yet</p>
          ) : (
            exercises.map((ex, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-ink-700">{ex.exercise_name}</span>
                <span className="text-xs text-ink-400">
                  {ex.sets} × {ex.min_reps ?? '?'}
                  {ex.max_reps && ex.max_reps !== ex.min_reps ? `–${ex.max_reps}` : ''} reps
                </span>
              </div>
            ))
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onEdit}
              className="text-xs text-accent-600 hover:text-accent-700 font-medium min-h-[44px]"
            >
              Edit exercises
            </button>
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-600 min-h-[44px]"
            >
              Delete day
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Program card ──────────────────────────────────────────────────────────────

function ProgramCard({ program }: { program: TrainingProgram }) {
  const [open,       setOpen]       = useState(false)
  const [newDay,     setNewDay]     = useState('')
  const [editWorkout, setEditWorkout] = useState<ProgramWorkout | null>(null)

  const { data: workouts = [] }   = useProgramWorkouts(open ? program.id : undefined)
  const createWorkout             = useCreateProgramWorkout()
  const delProgram                = useDeleteProgram()

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
    <>
      <div className="bg-white border border-ink-200 rounded-2xl overflow-hidden shadow-card">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-left min-h-[44px] hover:bg-cream-50 transition-colors duration-150"
        >
          <div>
            <p className="text-sm font-semibold text-ink-900">{program.name}</p>
            {program.description && (
              <p className="text-xs text-ink-400 mt-0.5">{program.description}</p>
            )}
          </div>
          <span className="text-ink-300 text-xs ml-3">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="border-t border-ink-100 px-5 py-4 space-y-3">
            {workouts.map(w => (
              <WorkoutRow
                key={w.id}
                workout={w}
                programId={program.id}
                onEdit={() => setEditWorkout(w)}
              />
            ))}

            {/* Add workout day */}
            <div className="flex gap-2">
              <input
                value={newDay}
                onChange={e => setNewDay(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addDay()}
                placeholder="New day name (e.g. Chest Day)…"
                className="flex-1 border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
              />
              <button
                onClick={addDay}
                disabled={!newDay.trim() || createWorkout.isPending}
                className="px-3 text-sm bg-accent-500 text-white rounded-lg hover:bg-accent-600 disabled:opacity-40 transition-colors duration-150 min-h-[44px]"
              >
                Add
              </button>
            </div>

            <button
              onClick={handleDeleteProgram}
              className="text-[11px] text-red-400 hover:text-red-600 min-h-[44px]"
            >
              Delete program
            </button>
          </div>
        )}
      </div>

      {editWorkout && (
        <EditWorkoutModal
          workout={editWorkout}
          onClose={() => setEditWorkout(null)}
        />
      )}
    </>
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
        <div className="text-center py-10 border border-dashed border-ink-200 rounded-2xl">
          <p className="text-ink-400 text-sm mb-1">No programs yet</p>
          <p className="text-ink-300 text-xs">Create a program (e.g. "5 Day Split") then add workout days.</p>
        </div>
      )}

      {programs.map(p => <ProgramCard key={p.id} program={p} />)}

      {showForm ? (
        <div className="bg-white border border-ink-200 rounded-2xl p-5 space-y-3 shadow-card">
          <p className="text-sm font-semibold text-ink-900">New program</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Program name (e.g. 5 Day Split)"
            autoFocus
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
          />
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || create.isPending}
              className="flex-1 btn-primary py-2"
            >
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setName(''); setDesc('') }}
              className="px-4 py-2 text-sm text-ink-500 hover:text-ink-700 border border-ink-200 rounded-lg min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 border border-dashed border-ink-200 rounded-2xl text-sm text-accent-600 hover:border-accent-300 hover:bg-accent-50 transition-colors duration-150 min-h-[44px]"
        >
          + New program
        </button>
      )}
    </div>
  )
}
