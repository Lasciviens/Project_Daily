import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop, Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyRoutineFolders, useCreateHevyRoutine, useUpdateHevyRoutine } from '../hooks/useHevyRoutines'
import type { HevyRoutine, HevyExerciseTemplate } from '../types.hevy'

// ─── Types for form state ─────────────────────────────────────────────────────

type SetType = 'normal' | 'warmup' | 'dropset' | 'failure'

interface FormSet {
  _key:            string
  type:            SetType
  weight_kg:       string
  reps:            string
  rep_range_start: string
  rep_range_end:   string
}

interface FormExercise {
  _key:              string
  exercise_template_id: string
  title:             string
  sets:              FormSet[]
}

function newKey() { return Math.random().toString(36).slice(2) }

function blankSet(): FormSet {
  return { _key: newKey(), type: 'normal', weight_kg: '', reps: '', rep_range_start: '', rep_range_end: '' }
}

function blankExercise(template: HevyExerciseTemplate): FormExercise {
  return {
    _key: newKey(),
    exercise_template_id: template.id,
    title: template.title,
    sets: [blankSet()],
  }
}

// Convert existing routine data to form state
function routineToForm(routine: HevyRoutine): { title: string; folder_id: string; exercises: FormExercise[] } {
  return {
    title:     routine.title,
    folder_id: routine.folder_id != null ? String(routine.folder_id) : '',
    exercises: (routine.exercises ?? []).map(ex => ({
      _key:                    newKey(),
      exercise_template_id:    ex.exercise_template_id,
      title:                   ex.title,
      sets: (ex.sets ?? []).map(s => ({
        _key:            newKey(),
        type:            s.type,
        weight_kg:       s.weight_kg != null ? String(s.weight_kg) : '',
        reps:            s.reps != null ? String(s.reps) : '',
        rep_range_start: s.rep_range_start != null ? String(s.rep_range_start) : '',
        rep_range_end:   s.rep_range_end != null ? String(s.rep_range_end) : '',
      })),
    })),
  }
}

// Build API payload from form state
function formToPayload(
  form: { title: string; folder_id: string; exercises: FormExercise[] },
  routineId?: string,
) {
  return {
    ...(routineId ? { id: routineId } : {}),
    title:     form.title.trim(),
    folder_id: form.folder_id ? Number(form.folder_id) : null,
    notes:     null,
    exercises: form.exercises.map((ex, exIdx) => ({
      index:                exIdx,
      exercise_template_id: ex.exercise_template_id,
      title:                ex.title,
      notes:                null,
      rest_seconds:         null,
      supersets_id:         null,
      sets: ex.sets.map((s, setIdx) => ({
        index:           setIdx,
        type:            s.type,
        weight_kg:       s.weight_kg !== '' ? Number(s.weight_kg) : null,
        reps:            s.reps !== '' ? Number(s.reps) : null,
        rep_range_start: s.rep_range_start !== '' ? Number(s.rep_range_start) : null,
        rep_range_end:   s.rep_range_end !== '' ? Number(s.rep_range_end) : null,
        distance_meters: null,
        duration_seconds: null,
        rpe:             null,
        custom_metric:   null,
      })),
    })),
  }
}

// ─── Set Type selector ────────────────────────────────────────────────────────

const SET_TYPE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'normal',  label: 'Normal'  },
  { value: 'warmup',  label: 'Warmup'  },
  { value: 'dropset', label: 'Dropset' },
  { value: 'failure', label: 'Failure' },
]

// ─── Exercise search combobox ─────────────────────────────────────────────────

interface ExerciseSearchProps {
  templates: HevyExerciseTemplate[]
  onSelect: (t: HevyExerciseTemplate) => void
}

function ExerciseSearch({ templates, onSelect }: ExerciseSearchProps) {
  const [query, setQuery] = useState('')

  const filtered = query.length < 1
    ? []
    : templates.filter(t => t.title.toLowerCase().includes(query.toLowerCase())).slice(0, 20)

  return (
    <Combobox
      onChange={(t: HevyExerciseTemplate | null) => {
        if (t) { onSelect(t); setQuery('') }
      }}
      onClose={() => {}}
    >
      <div className="relative">
        <ComboboxInput
          className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
          placeholder="Search and add exercise…"
          displayValue={() => query}
          onChange={e => setQuery(e.target.value)}
        />
        {filtered.length > 0 && (
          <ComboboxOptions className="absolute z-50 mt-1 w-full rounded-xl border border-ink-200 bg-white shadow-lg max-h-56 overflow-y-auto">
            {filtered.map(t => (
              <ComboboxOption
                key={t.id}
                value={t}
                className="px-4 py-2.5 text-sm text-ink-800 cursor-pointer data-[focus]:bg-cream-50"
              >
                <span className="font-medium">{t.title}</span>
                {t.primary_muscle_group && (
                  <span className="ml-2 text-xs text-ink-400 capitalize">{t.primary_muscle_group}</span>
                )}
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        )}
      </div>
    </Combobox>
  )
}

// ─── Shared modal body ────────────────────────────────────────────────────────

interface RoutineFormProps {
  title:     string
  onClose:   () => void
  initial?:  HevyRoutine
}

function RoutineFormContent({ title, onClose, initial }: RoutineFormProps) {
  const { data: folders  = [] } = useHevyRoutineFolders()
  const { data: templates = [] } = useHevyExerciseTemplates()
  const createMutation = useCreateHevyRoutine()
  const updateMutation = useUpdateHevyRoutine()

  const [form, setForm] = useState(() =>
    initial
      ? routineToForm(initial)
      : { title: '', folder_id: '', exercises: [] as FormExercise[] }
  )

  function setTitle(v: string) { setForm(f => ({ ...f, title: v })) }
  function setFolderId(v: string) { setForm(f => ({ ...f, folder_id: v })) }

  function addExercise(t: HevyExerciseTemplate) {
    setForm(f => ({ ...f, exercises: [...f.exercises, blankExercise(t)] }))
  }

  function removeExercise(key: string) {
    setForm(f => ({ ...f, exercises: f.exercises.filter(e => e._key !== key) }))
  }

  function addSet(exKey: string) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e =>
        e._key === exKey ? { ...e, sets: [...e.sets, blankSet()] } : e
      ),
    }))
  }

  function removeSet(exKey: string, setKey: string) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e =>
        e._key === exKey ? { ...e, sets: e.sets.filter(s => s._key !== setKey) } : e
      ),
    }))
  }

  function updateSet(exKey: string, setKey: string, patch: Partial<FormSet>) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e =>
        e._key === exKey
          ? { ...e, sets: e.sets.map(s => s._key === setKey ? { ...s, ...patch } : s) }
          : e
      ),
    }))
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  async function handleSave() {
    if (!form.title.trim()) return
    const payload = formToPayload(form, initial?.id)
    try {
      if (initial) {
        await updateMutation.mutateAsync(payload)
      } else {
        await createMutation.mutateAsync(payload)
      }
      onClose()
    } catch {
      // error toast handled by mutation's onError callback
    }
  }

  return (
    <>
      {/* Modal header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-ink-100">
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors text-xl leading-none"
        >
          ×
        </button>
      </div>

      <div className="px-5 py-4 flex flex-col gap-5 overflow-y-auto max-h-[calc(90vh-8rem)]">
        {/* Title */}
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
            Routine title
          </label>
          <input
            type="text"
            value={form.title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Push Day A"
            className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-4 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
        </div>

        {/* Folder picker */}
        {folders.length > 0 && (
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
              Folder (optional)
            </label>
            <select
              value={form.folder_id}
              onChange={e => setFolderId(e.target.value)}
              className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400"
            >
              <option value="">No folder</option>
              {folders.map(f => (
                <option key={f.id} value={String(f.id)}>{f.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Exercises */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">
            Exercises ({form.exercises.length})
          </p>

          {form.exercises.length > 0 && (
            <div className="flex flex-col gap-3 mb-3">
              {form.exercises.map((ex, exIdx) => (
                <div key={ex._key} className="border border-ink-200 rounded-xl overflow-hidden">
                  {/* Exercise header */}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-cream-50 border-b border-ink-100">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-ink-400">{exIdx + 1}</span>
                      <span className="text-sm font-semibold text-ink-800">{ex.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExercise(ex._key)}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors text-sm"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Sets */}
                  <div className="px-3 py-2 flex flex-col gap-2">
                    {ex.sets.map((s, sIdx) => (
                      <div key={s._key} className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-ink-400 w-4 text-center">{sIdx + 1}</span>
                        <select
                          value={s.type}
                          onChange={e => updateSet(ex._key, s._key, { type: e.target.value as SetType })}
                          className="h-9 bg-cream-50 border border-ink-200 rounded-lg text-xs text-ink-700 px-2 focus:outline-none focus:ring-1 focus:ring-accent-400"
                        >
                          {SET_TYPE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={s.weight_kg}
                          onChange={e => updateSet(ex._key, s._key, { weight_kg: e.target.value })}
                          placeholder="kg"
                          className="w-16 h-9 bg-cream-50 border border-ink-200 rounded-lg text-xs text-ink-900 px-2 focus:outline-none focus:ring-1 focus:ring-accent-400"
                        />
                        <input
                          type="number"
                          value={s.reps}
                          onChange={e => updateSet(ex._key, s._key, { reps: e.target.value })}
                          placeholder="reps"
                          className="w-16 h-9 bg-cream-50 border border-ink-200 rounded-lg text-xs text-ink-900 px-2 focus:outline-none focus:ring-1 focus:ring-accent-400"
                        />
                        <span className="text-xs text-ink-400">or</span>
                        <input
                          type="number"
                          value={s.rep_range_start}
                          onChange={e => updateSet(ex._key, s._key, { rep_range_start: e.target.value })}
                          placeholder="min"
                          className="w-14 h-9 bg-cream-50 border border-ink-200 rounded-lg text-xs text-ink-900 px-2 focus:outline-none focus:ring-1 focus:ring-accent-400"
                        />
                        <span className="text-xs text-ink-400">–</span>
                        <input
                          type="number"
                          value={s.rep_range_end}
                          onChange={e => updateSet(ex._key, s._key, { rep_range_end: e.target.value })}
                          placeholder="max"
                          className="w-14 h-9 bg-cream-50 border border-ink-200 rounded-lg text-xs text-ink-900 px-2 focus:outline-none focus:ring-1 focus:ring-accent-400"
                        />
                        {ex.sets.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSet(ex._key, s._key)}
                            className="h-9 w-9 flex items-center justify-center text-ink-300 hover:text-red-500 transition-colors"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => addSet(ex._key)}
                      className="mt-1 text-xs text-accent-600 font-medium hover:text-accent-700 text-left min-h-[32px]"
                    >
                      + Add set
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add exercise search */}
          <ExerciseSearch templates={templates} onSelect={addExercise} />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
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
          disabled={isLoading || !form.title.trim()}
          className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Saving…' : 'Save Routine'}
        </button>
      </div>
    </>
  )
}

// ─── New Routine Modal ────────────────────────────────────────────────────────

interface NewRoutineModalProps {
  isOpen:  boolean
  onClose: () => void
}

export function NewRoutineModal({ isOpen, onClose }: NewRoutineModalProps) {
  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-2xl bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          <RoutineFormContent title="New Routine" onClose={onClose} />
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// ─── Edit Routine Modal ───────────────────────────────────────────────────────

interface EditRoutineModalProps {
  routine: HevyRoutine | null
  onClose: () => void
}

export function EditRoutineModal({ routine, onClose }: EditRoutineModalProps) {
  return (
    <Dialog open={routine != null} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-2xl bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {routine && (
            <RoutineFormContent title={`Edit: ${routine.title}`} onClose={onClose} initial={routine} />
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
