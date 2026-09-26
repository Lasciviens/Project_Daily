import { useState, useMemo } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { format } from 'date-fns'
import { Plus, X } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, IconButton } from '../../../shared/ui'
import { useLogHevyWorkout } from '../hooks/useHevyWorkouts'
import { useHevyRoutines } from '../hooks/useHevyRoutines'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { SET_TYPE_OPTIONS, type SetType } from '../setTypeMeta'
import type { HevyExerciseTemplate, HevyRoutine } from '../types.hevy'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SetRow {
  id: number
  type: SetType
  weight_kg: string
  reps: string
}

interface ExerciseRow {
  id: number
  template: HevyExerciseTemplate | null
  query: string
  sets: SetRow[]
}

let _setId = 1
let _exId  = 1
function nextSetId() { return _setId++ }
function nextExId()  { return _exId++ }

function blankSet(): SetRow {
  return { id: nextSetId(), type: 'normal', weight_kg: '', reps: '' }
}

function blankExercise(): ExerciseRow {
  return { id: nextExId(), template: null, query: '', sets: [blankSet()] }
}

// A datetime-local input takes LOCAL wall time (toISOString would be UTC).
function localDateTimeString(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm")
}

// ─── Exercise row component ───────────────────────────────────────────────────

interface ExerciseRowProps {
  ex: ExerciseRow
  templates: HevyExerciseTemplate[]
  onChange: (updated: ExerciseRow) => void
  onRemove: () => void
}

function ExerciseRowEditor({ ex, templates, onChange, onRemove }: ExerciseRowProps) {
  const filtered = useMemo(() => {
    if (!ex.query.trim()) return templates.slice(0, 20)
    const q = ex.query.toLowerCase()
    return templates.filter(t => t.title.toLowerCase().includes(q)).slice(0, 30)
  }, [templates, ex.query])

  function updateSet(setId: number, patch: Partial<SetRow>) {
    onChange({ ...ex, sets: ex.sets.map(s => s.id === setId ? { ...s, ...patch } : s) })
  }

  function addSet() {
    onChange({ ...ex, sets: [...ex.sets, blankSet()] })
  }

  function removeSet(setId: number) {
    if (ex.sets.length === 1) return
    onChange({ ...ex, sets: ex.sets.filter(s => s.id !== setId) })
  }

  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div className="flex items-center gap-1 border-b border-line bg-surface-2 py-2 pl-3 pr-1">
        <div className="relative flex-1">
          <Combobox
            value={ex.template}
            onChange={t => onChange({ ...ex, template: t, query: t?.title ?? '' })}
            onClose={() => {}}
          >
            <ComboboxInput
              aria-label="Exercise"
              className="input w-full"
              placeholder="Search exercise…"
              displayValue={(t: HevyExerciseTemplate | null) => t?.title ?? ''}
              onChange={e => onChange({ ...ex, query: e.target.value })}
            />
            <ComboboxOptions className="menu absolute mt-1 max-h-52 w-full overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-2.5 py-2 text-body text-fg-muted">No matches</div>
              ) : (
                filtered.map(t => (
                  <ComboboxOption key={t.id} value={t} className="menu-item cursor-pointer">
                    <span className="font-medium">{t.title}</span>
                    {t.primary_muscle_group && (
                      <span className="ml-auto text-meta capitalize text-fg-muted">{t.primary_muscle_group}</span>
                    )}
                  </ComboboxOption>
                ))
              )}
            </ComboboxOptions>
          </Combobox>
        </div>
        <IconButton label="Remove exercise" onClick={onRemove} className="text-fg-faint hover:!text-danger">
          <X />
        </IconButton>
      </div>

      <div className="px-3 pb-1 pt-2">
        <div className="mb-1.5 grid grid-cols-[88px_1fr_1fr_44px] gap-2 px-1 text-micro font-semibold uppercase tracking-[0.08em] text-fg-muted">
          <span>Type</span><span>Weight (kg)</span><span>Reps</span><span />
        </div>

        {ex.sets.map((s, i) => (
          <div key={s.id} className="mb-1.5 grid grid-cols-[88px_1fr_1fr_44px] items-center gap-2">
            <select
              aria-label={`Set ${i + 1} type`}
              value={s.type}
              onChange={e => updateSet(s.id, { type: e.target.value as SetType })}
              className="select w-full px-2"
            >
              {SET_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              aria-label={`Set ${i + 1} weight`}
              type="number"
              step="0.5"
              min="0"
              value={s.weight_kg}
              onChange={e => updateSet(s.id, { weight_kg: e.target.value })}
              placeholder="—"
              className="input w-full px-2"
            />
            <input
              aria-label={`Set ${i + 1} reps`}
              type="number"
              min="0"
              value={s.reps}
              onChange={e => updateSet(s.id, { reps: e.target.value })}
              placeholder="—"
              className="input w-full px-2"
            />
            <IconButton
              label={`Remove set ${i + 1}`}
              onClick={() => removeSet(s.id)}
              disabled={ex.sets.length === 1}
              className="text-fg-faint hover:!text-danger disabled:opacity-30"
            >
              <X />
            </IconButton>
          </div>
        ))}

        <button type="button" onClick={addSet} className="btn-ghost btn-sm mb-1 gap-1 px-2 text-meta !text-accent-600">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add set
        </button>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean
  onClose: () => void
}

// The form mounts only while open, so each opening starts blank.
export function LogHevyWorkoutModal({ isOpen, onClose }: Props) {
  return isOpen ? <LogHevyWorkoutForm onClose={onClose} /> : null
}

function LogHevyWorkoutForm({ onClose }: { onClose: () => void }) {
  const logWorkout = useLogHevyWorkout()
  const { data: routines = [] } = useHevyRoutines()
  const { data: templates = [] } = useHevyExerciseTemplates()

  const [title, setTitle]         = useState('')
  const [dateTime, setDateTime]   = useState(localDateTimeString)
  const [routineId, setRoutineId] = useState('')
  const [exercises, setExercises] = useState<ExerciseRow[]>(() => [blankExercise()])

  // When a routine is picked, pre-populate exercises
  function handleRoutineChange(id: string) {
    setRoutineId(id)
    if (!id) return
    const routine: HevyRoutine | undefined = routines.find(r => r.id === id)
    if (!routine?.exercises?.length) return
    const rows: ExerciseRow[] = routine.exercises.map(re => {
      const tmpl = templates.find(t => t.id === re.exercise_template_id) ?? null
      const sets: SetRow[] = (re.sets ?? [blankSet()]).map(rs => ({
        id:       nextSetId(),
        type:     (rs.type as SetType) ?? 'normal',
        weight_kg: rs.weight_kg != null ? String(rs.weight_kg) : '',
        reps:     rs.reps != null ? String(rs.reps) : '',
      }))
      return { id: nextExId(), template: tmpl, query: re.title, sets: sets.length ? sets : [blankSet()] }
    })
    setExercises(rows)
    if (!title) setTitle(routine.title)
  }

  function updateExercise(id: number, updated: ExerciseRow) {
    setExercises(exs => exs.map(e => e.id === id ? updated : e))
  }

  function removeExercise(id: number) {
    setExercises(exs => exs.length > 1 ? exs.filter(e => e.id !== id) : exs)
  }

  function addExercise() {
    setExercises(exs => [...exs, blankExercise()])
  }

  async function handleSave() {
    if (!title.trim()) return

    const start = new Date(dateTime).toISOString()
    const payload = {
      title: title.trim(),
      start_time: start,
      end_time:   start, // Hevy requires end_time; user can edit later in the app
      description: null,
      exercises: exercises
        .filter(e => e.template != null)
        .map((e, ei) => ({
          index:               ei,
          title:               e.template!.title,
          notes:               null,
          exercise_template_id: e.template!.id,
          supersets_id:        null,
          sets: e.sets.map((s, si) => ({
            index:            si,
            type:             s.type,
            weight_kg:        s.weight_kg !== '' ? Number(s.weight_kg) : null,
            reps:             s.reps !== '' ? Number(s.reps) : null,
            distance_meters:  null,
            duration_seconds: null,
            rpe:              null,
            custom_metric:    null,
          })),
        })),
    }

    try {
      await logWorkout.mutateAsync(payload)
    } catch {
      return
    }
    onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      title="Log workout"
      size="lg"
      dismissible={!logWorkout.isPending}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={logWorkout.isPending} disabled={!title.trim()} className="w-full sm:w-auto">
            Log workout
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="log-workout-title" className="field-label">Title <span className="text-danger">*</span></label>
          <input
            id="log-workout-title"
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Push Day"
            className="input w-full"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="log-workout-when" className="field-label">Date &amp; time</label>
            <input
              id="log-workout-when"
              type="datetime-local"
              value={dateTime}
              onChange={e => setDateTime(e.target.value)}
              className="input w-full"
            />
          </div>

          {routines.length > 0 && (
            <div>
              <label htmlFor="log-workout-routine" className="field-label">Start from routine (optional)</label>
              <select
                id="log-workout-routine"
                value={routineId}
                onChange={e => handleRoutineChange(e.target.value)}
                className="select w-full"
              >
                <option value="">None</option>
                {routines.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </div>
          )}
        </div>

        <div>
          <p className="field-label">Exercises</p>
          <div className="flex flex-col gap-3">
            {exercises.map(ex => (
              <ExerciseRowEditor
                key={ex.id}
                ex={ex}
                templates={templates}
                onChange={updated => updateExercise(ex.id, updated)}
                onRemove={() => removeExercise(ex.id)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addExercise}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong text-body text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add exercise
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
