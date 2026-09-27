import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Dumbbell, Plus, X } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, EmptyState } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { useLogHevyWorkout } from '../hooks/useHevyWorkouts'
import { useHevyRoutines } from '../hooks/useHevyRoutines'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import {
  blankExercise, blankSet, newKey, routineToWorkoutExercises, sanitizeInteger, setFieldsForType,
  validateWorkoutForm, workoutFormToPayload, workoutTimes,
  type FormSet, type WorkoutForm,
} from '../routineForm'
import { ExerciseSearch, SetRow } from './RoutineFormParts'
import type { HevyExerciseTemplate } from '../types.hevy'

// The log form is the routine editor's exercise/set model (same search, same
// per-type set rows, same strict payload builder — routineForm.ts) plus a
// start time and a duration. It used to carry its own copy that sent keys
// Hevy rejects (exercise index/title, set index), only knew weight × reps,
// and saved every workout as 0 minutes long.

interface Props {
  isOpen: boolean
  onClose: () => void
}

// The form mounts only while open, so each opening starts blank.
export function LogHevyWorkoutModal({ isOpen, onClose }: Props) {
  return isOpen ? <LogHevyWorkoutForm onClose={onClose} /> : null
}

const DEFAULT_DURATION_MIN = '60'

function LogHevyWorkoutForm({ onClose }: { onClose: () => void }) {
  const logWorkout = useLogHevyWorkout()
  const { data: routines = [] } = useHevyRoutines()
  const { data: templates = [] } = useHevyExerciseTemplates()

  const [form, setForm] = useState<WorkoutForm>(() => ({
    title: '',
    description: '',
    // A datetime-local input takes LOCAL wall time.
    startLocal: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    durationMin: DEFAULT_DURATION_MIN,
    exercises: [],
  }))
  const [prefillId, setPrefillId] = useState('')

  const typeById = useMemo(() => new Map(templates.map(t => [t.id, t.type])), [templates])
  const patch = (p: Partial<WorkoutForm>) => setForm(f => ({ ...f, ...p }))

  // Hevy's POST /v1/workouts has no routine_id, so a routine can only
  // PREFILL the form — the logged workout isn't linked to it.
  function prefillFromRoutine(id: string) {
    setPrefillId(id)
    const routine = routines.find(r => r.id === id)
    if (!routine) return
    setForm(f => ({ ...f, title: f.title || routine.title, exercises: routineToWorkoutExercises(routine) }))
  }

  function addExercise(t: HevyExerciseTemplate) {
    setForm(f => ({ ...f, exercises: [...f.exercises, blankExercise(t)] }))
  }
  function removeExercise(key: string) {
    setForm(f => ({ ...f, exercises: f.exercises.filter(e => e._key !== key) }))
  }
  function updateSet(exKey: string, setKey: string, p: Partial<FormSet>) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e => e._key === exKey ? { ...e, sets: e.sets.map(s => s._key === setKey ? { ...s, ...p } : s) } : e),
    }))
  }
  function addSet(exKey: string) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e => {
        if (e._key !== exKey) return e
        const last = e.sets[e.sets.length - 1]
        return { ...e, sets: [...e.sets, last ? { ...last, _key: newKey() } : blankSet()] }
      }),
    }))
  }
  function removeSet(exKey: string, setKey: string) {
    setForm(f => ({ ...f, exercises: f.exercises.map(e => e._key === exKey ? { ...e, sets: e.sets.filter(s => s._key !== setKey) } : e) }))
  }

  async function handleSave() {
    const problem = validateWorkoutForm(form)
    const times = workoutTimes(form.startLocal, form.durationMin)
    if (problem || !times) {
      toast.error(problem ?? 'Pick the date and time the workout started.')
      return
    }
    try {
      await logWorkout.mutateAsync(workoutFormToPayload(form, times))
    } catch {
      return
    }
    onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Log workout"
      size="xl"
      mobile="fullscreen"
      dismissible={!logWorkout.isPending}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={logWorkout.isPending} className="w-full sm:w-auto">
            Log workout
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="log-workout-title" className="field-label">Title <span className="text-danger">*</span></label>
            <input id="log-workout-title" type="text" value={form.title} onChange={e => patch({ title: e.target.value })} placeholder="e.g. Push Day" className="input w-full" />
          </div>
          {routines.length > 0 && (
            <div>
              <label htmlFor="log-workout-routine" className="field-label">Prefill from routine (optional)</label>
              <select id="log-workout-routine" value={prefillId} onChange={e => prefillFromRoutine(e.target.value)} className="select w-full">
                <option value="">None</option>
                {routines.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-4 sm:max-w-md">
          <div>
            <label htmlFor="log-workout-when" className="field-label">Started</label>
            <input id="log-workout-when" type="datetime-local" value={form.startLocal} onChange={e => patch({ startLocal: e.target.value })} className="input w-full" />
          </div>
          <div>
            <label htmlFor="log-workout-duration" className="field-label">Minutes</label>
            <input
              id="log-workout-duration" type="text" inputMode="numeric" value={form.durationMin}
              onChange={e => patch({ durationMin: sanitizeInteger(e.target.value) })}
              className="input w-full text-center"
            />
          </div>
        </div>

        <div>
          <p className="field-label">Exercises ({form.exercises.length})</p>
          <div className="mb-3 max-w-md">
            <ExerciseSearch templates={templates} onSelect={addExercise} />
          </div>

          {form.exercises.length === 0 ? (
            <EmptyState bordered icon={<Dumbbell />} title="No exercises yet" description="Search above, or prefill from a routine." className="py-8" />
          ) : (
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {form.exercises.map((ex, exIdx) => {
                const fields = setFieldsForType(typeById.get(ex.exercise_template_id))
                return (
                  <div key={ex._key} className="overflow-hidden rounded-card border border-line">
                    <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 py-1 pl-3 pr-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-meta font-bold tabular-nums text-fg-faint">{exIdx + 1}</span>
                        <span className="truncate text-body font-semibold text-fg">{ex.title}</span>
                      </div>
                      <button type="button" onClick={() => removeExercise(ex._key)} className="icon-btn shrink-0 text-fg-faint hover:!text-danger" aria-label={`Remove ${ex.title}`}>
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5 px-3 py-2.5">
                      {ex.sets.map((s, sIdx) => (
                        <SetRow
                          key={s._key}
                          set={s}
                          index={sIdx}
                          fields={fields}
                          useRange={false}
                          canRemove={ex.sets.length > 1}
                          showLabel={sIdx === 0}
                          showRpe
                          onChange={p => updateSet(ex._key, s._key, p)}
                          onRemove={() => removeSet(ex._key, s._key)}
                        />
                      ))}
                      <button type="button" onClick={() => addSet(ex._key)} className="btn-ghost btn-sm mt-1 self-start gap-1 px-2 text-meta !text-accent-600">
                        <Plus className="h-3.5 w-3.5" aria-hidden /> Add set
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="log-workout-notes" className="field-label">Notes (optional)</label>
          <textarea id="log-workout-notes" value={form.description} onChange={e => patch({ description: e.target.value })} rows={2} className="input w-full resize-y py-2.5" />
        </div>
      </div>
    </ModalShell>
  )
}
