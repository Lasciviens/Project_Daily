import { useState, useMemo } from 'react'
import {
  Dialog, DialogPanel, DialogBackdrop,
  Combobox, ComboboxInput, ComboboxOptions, ComboboxOption,
} from '@headlessui/react'
import { useQueryClient } from '@tanstack/react-query'
import { callHevyApi } from '../api/hevyApi'
import { useHevyRoutines } from '../hooks/useHevyRoutines'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { toast } from '../../../app/store'
import type { HevyExerciseTemplate, HevyRoutine } from '../types.hevy'

// ─── Types ────────────────────────────────────────────────────────────────────

type SetType = 'normal' | 'warmup' | 'dropset' | 'failure'

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

function localDateTimeString(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16)
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
    <div className="border border-ink-200 rounded-xl overflow-hidden">
      {/* Exercise header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-cream-50 border-b border-ink-100">
        <div className="flex-1 relative">
          <Combobox
            value={ex.template}
            onChange={t => onChange({ ...ex, template: t, query: t?.title ?? '' })}
            onClose={() => {}}
          >
            <ComboboxInput
              className="w-full min-h-[40px] bg-white border border-ink-200 rounded-lg px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
              placeholder="Search exercise…"
              displayValue={(t: HevyExerciseTemplate | null) => t?.title ?? ''}
              onChange={e => onChange({ ...ex, query: e.target.value })}
            />
            <ComboboxOptions className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-ink-200 rounded-xl shadow-lg">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-ink-400">No matches</div>
              ) : (
                filtered.map(t => (
                  <ComboboxOption
                    key={t.id}
                    value={t}
                    className="px-3 py-2 cursor-pointer text-sm text-ink-800 data-[focus]:bg-cream-50"
                  >
                    <span className="font-medium">{t.title}</span>
                    {t.primary_muscle_group && (
                      <span className="ml-2 text-[11px] text-ink-400 capitalize">{t.primary_muscle_group}</span>
                    )}
                  </ComboboxOption>
                ))
              )}
            </ComboboxOptions>
          </Combobox>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors"
          title="Remove exercise"
        >
          ✕
        </button>
      </div>

      {/* Sets */}
      <div className="px-3 pt-2 pb-1">
        <div className="grid grid-cols-[80px_1fr_1fr_36px] gap-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 px-1">
          <span>Type</span><span>Weight (kg)</span><span>Reps</span><span />
        </div>

        {ex.sets.map((s) => (
          <div key={s.id} className="grid grid-cols-[80px_1fr_1fr_36px] gap-2 mb-1.5 items-center">
            <select
              value={s.type}
              onChange={e => updateSet(s.id, { type: e.target.value as SetType })}
              className="min-h-[36px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-xs text-ink-700 focus:outline-none focus:ring-1 focus:ring-accent-400"
            >
              <option value="normal">Normal</option>
              <option value="warmup">Warmup</option>
              <option value="dropset">Dropset</option>
              <option value="failure">Failure</option>
            </select>
            <input
              type="number"
              step="0.5"
              min="0"
              value={s.weight_kg}
              onChange={e => updateSet(s.id, { weight_kg: e.target.value })}
              placeholder="—"
              className="min-h-[36px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent-400"
            />
            <input
              type="number"
              min="0"
              value={s.reps}
              onChange={e => updateSet(s.id, { reps: e.target.value })}
              placeholder="—"
              className="min-h-[36px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent-400"
            />
            <button
              type="button"
              onClick={() => removeSet(s.id)}
              disabled={ex.sets.length === 1}
              className="min-h-[36px] flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors disabled:opacity-30 text-xs"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addSet}
          className="text-xs text-accent-600 hover:text-accent-800 font-medium min-h-[36px] flex items-center gap-1 mb-1"
        >
          + Add set
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

export function LogHevyWorkoutModal({ isOpen, onClose }: Props) {
  const qc = useQueryClient()
  const { data: routines = [] } = useHevyRoutines()
  const { data: templates = [] } = useHevyExerciseTemplates()

  const [title, setTitle]         = useState('')
  const [dateTime, setDateTime]   = useState(localDateTimeString)
  const [routineId, setRoutineId] = useState('')
  const [exercises, setExercises] = useState<ExerciseRow[]>([blankExercise()])
  const [saving, setSaving]       = useState(false)

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
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

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

    setSaving(true)
    const tid = toast.loading('Saving workout…')
    try {
      await callHevyApi('create_workout', payload)
      qc.invalidateQueries({ queryKey: ['hevy', 'workouts'] })
      toast.dismiss(tid)
      toast.success('Workout logged ✓')
      onClose()
      // reset
      setTitle('')
      setDateTime(localDateTimeString())
      setRoutineId('')
      setExercises([blankExercise()])
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed to save workout')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100 sticky top-0 bg-white z-10">
            <h2 className="text-base font-bold text-ink-900">Log Workout</h2>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Title */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Push Day"
                className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>

            {/* Date + time */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Date &amp; time
              </label>
              <input
                type="datetime-local"
                value={dateTime}
                onChange={e => setDateTime(e.target.value)}
                className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>

            {/* Routine picker */}
            {routines.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                  Start from routine (optional)
                </label>
                <select
                  value={routineId}
                  onChange={e => handleRoutineChange(e.target.value)}
                  className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
                >
                  <option value="">— None —</option>
                  {routines.map(r => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Exercises */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">
                Exercises
              </p>
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
                className="mt-3 min-h-[44px] w-full border border-dashed border-ink-300 rounded-xl text-sm text-ink-500 hover:bg-cream-50 hover:text-ink-700 transition-colors"
              >
                + Add exercise
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Log Workout'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
