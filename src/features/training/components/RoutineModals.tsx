import { useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogPanel, DialogBackdrop, Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyRoutineFolders, useCreateHevyRoutine, useUpdateHevyRoutine } from '../hooks/useHevyRoutines'
import type { HevyRoutine, HevyExerciseTemplate } from '../types.hevy'

// ─── Types for form state ─────────────────────────────────────────────────────

type SetType = 'normal' | 'warmup' | 'dropset' | 'failure'

interface FormSet {
  _key:             string
  type:             SetType
  weight_kg:        string
  reps:             string
  rep_range_start:  string
  rep_range_end:    string
  distance_meters:  string
  duration_seconds: string
  custom_metric:    string
}

interface FormExercise {
  _key:                 string
  exercise_template_id: string
  title:                string
  notes:                string
  rest_seconds:         string
  superset_id:          string
  use_rep_range:        boolean
  sets:                 FormSet[]
}

interface RoutineForm {
  title:     string
  folder_id: string
  notes:     string
  exercises: FormExercise[]
}

function newKey() { return Math.random().toString(36).slice(2) }

function blankSet(): FormSet {
  return {
    _key: newKey(), type: 'normal',
    weight_kg: '', reps: '', rep_range_start: '', rep_range_end: '',
    distance_meters: '', duration_seconds: '', custom_metric: '',
  }
}

function blankExercise(template: HevyExerciseTemplate): FormExercise {
  return {
    _key: newKey(),
    exercise_template_id: template.id,
    title: template.title,
    notes: '',
    rest_seconds: '',
    superset_id: '',
    use_rep_range: false,
    sets: [blankSet()],
  }
}

// Which set metric inputs apply to a given Hevy exercise template type.
// Mirrors how Hevy itself renders set fields per exercise type.
function setFieldsForType(type: string | undefined) {
  switch (type) {
    // reps only, no weight
    case 'reps_only':
    case 'bodyweight_reps':
      return { weight: false, reps: true,  duration: false, distance: false }
    // time only (incl. stair-machine floors/steps — closest input is duration)
    case 'duration':
    case 'floors_duration':
    case 'steps_duration':
      return { weight: false, reps: false, duration: true,  distance: false }
    // weight + time
    case 'weight_duration':
      return { weight: true,  reps: false, duration: true,  distance: false }
    // distance + time
    case 'distance_duration':
      return { weight: false, reps: false, duration: true,  distance: true  }
    // weight + distance
    case 'short_distance_weight':
    case 'weight_distance':
      return { weight: true,  reps: false, duration: false, distance: true  }
    // weight + reps (incl. weighted/assisted bodyweight variants) and unknown
    default:
      return { weight: true,  reps: true,  duration: false, distance: false }
  }
}

// Convert existing routine data to form state
function routineToForm(routine: HevyRoutine): RoutineForm {
  return {
    title:     routine.title,
    folder_id: routine.folder_id != null ? String(routine.folder_id) : '',
    notes:     routine.notes ?? '',
    exercises: (routine.exercises ?? []).map(ex => ({
      _key:                 newKey(),
      exercise_template_id: ex.exercise_template_id,
      title:                ex.title,
      notes:                ex.notes ?? '',
      rest_seconds:         ex.rest_seconds != null ? String(ex.rest_seconds) : '',
      superset_id:          ex.supersets_id != null ? String(ex.supersets_id) : '',
      use_rep_range:        (ex.sets ?? []).some(s => s.rep_range_start != null),
      sets: (ex.sets ?? []).map(s => ({
        _key:             newKey(),
        type:             s.type,
        weight_kg:        s.weight_kg != null ? String(s.weight_kg) : '',
        reps:             s.reps != null ? String(s.reps) : '',
        rep_range_start:  s.rep_range_start != null ? String(s.rep_range_start) : '',
        rep_range_end:    s.rep_range_end != null ? String(s.rep_range_end) : '',
        distance_meters:  s.distance_meters != null ? String(s.distance_meters) : '',
        duration_seconds: s.duration_seconds != null ? String(s.duration_seconds) : '',
        custom_metric:    s.custom_metric != null ? String(s.custom_metric) : '',
      })),
    })),
  }
}

const numOrNull = (v: string) => (v.trim() !== '' ? Number(v) : null)

// Build the exact Hevy API payload. Field names and shape must match the
// Hevy OpenAPI schema for POST/PUT /v1/routines — any extra key triggers a
// "… is not allowed" 400. Notably: no exercise index/title, no set index/rpe,
// superset_id is singular, and rep ranges use the nested { start, end } object.
function formToPayload(form: RoutineForm, routineId?: string) {
  const isUpdate = !!routineId
  return {
    ...(routineId ? { id: routineId } : {}),
    title:     form.title.trim(),
    // Hevy's PUT /v1/routines/{id} rejects folder_id ("not allowed") — it's only
    // accepted on create (POST). So send it on create, omit it on update.
    ...(isUpdate ? {} : { folder_id: form.folder_id ? Number(form.folder_id) : null }),
    notes:     form.notes.trim() || null,
    exercises: form.exercises.map(ex => ({
      exercise_template_id: ex.exercise_template_id,
      superset_id:          numOrNull(ex.superset_id),
      rest_seconds:         numOrNull(ex.rest_seconds),
      notes:                ex.notes.trim() || null,
      sets: ex.sets.map(s => {
        // Hevy requires rep_range to be a { start, end } object OR absent — it
        // rejects `rep_range: null` with a 400. So include it only when a real
        // range is entered; otherwise send fixed reps and omit the key entirely.
        const hasRange = ex.use_rep_range && s.rep_range_start.trim() !== '' && s.rep_range_end.trim() !== ''
        const set: Record<string, unknown> = {
          type:             s.type,
          weight_kg:        numOrNull(s.weight_kg),
          distance_meters:  numOrNull(s.distance_meters),
          duration_seconds: numOrNull(s.duration_seconds),
          custom_metric:    numOrNull(s.custom_metric),
        }
        if (hasRange) {
          set.reps      = null
          set.rep_range = { start: Number(s.rep_range_start), end: Number(s.rep_range_end) }
        } else {
          set.reps = numOrNull(s.reps)
        }
        return set
      }),
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

const inputCls =
  'min-h-[44px] w-full bg-cream-50 border border-ink-200 rounded-lg text-sm text-ink-900 px-2.5 text-center focus:outline-none focus:ring-2 focus:ring-accent-400'

// Tiny field-label sits above a set input so the column is scannable.
// The label only renders on the header row; later rows keep the spacing.
function SetField({ label, showLabel, children, wide }: { label: string; showLabel: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-0.5 min-w-0 ${wide ? 'flex-[2]' : 'flex-1'}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 text-center leading-none h-[10px]">
        {showLabel ? label : ' '}
      </span>
      {children}
    </label>
  )
}

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
          <ComboboxOptions className="absolute z-50 mt-1 w-full rounded-xl border border-ink-200 bg-cream-50 shadow-lg max-h-56 overflow-y-auto">
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

// ─── Single set row ───────────────────────────────────────────────────────────

interface SetRowProps {
  set:       FormSet
  index:     number
  fields:    ReturnType<typeof setFieldsForType>
  useRange:  boolean
  canRemove: boolean
  showLabel: boolean
  onChange:  (patch: Partial<FormSet>) => void
  onRemove:  () => void
}

function SetRow({ set, index, fields, useRange, canRemove, showLabel, onChange, onRemove }: SetRowProps) {
  return (
    <div className="flex items-end gap-2">
      {/* Set number badge */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <span className="text-[10px] leading-none h-[10px]" aria-hidden />
        <span className="flex items-center justify-center w-7 min-h-[44px] rounded-lg bg-cream-100 text-xs font-bold text-ink-400">
          {index + 1}
        </span>
      </div>

      {/* Type — fixed width, the rest of the metrics share a flexible grid */}
      <div className="shrink-0 w-[84px] sm:w-[96px]">
        <SetField label="Type" showLabel={showLabel}>
          <select
            value={set.type}
            onChange={e => onChange({ type: e.target.value as SetType })}
            className={`${inputCls} !text-left px-2`}
          >
            {SET_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SetField>
      </div>

      <div className="flex-1 min-w-0 flex items-end gap-2">
        {fields.weight && (
          <SetField label="kg" showLabel={showLabel}>
            <input
              type="number" inputMode="decimal" value={set.weight_kg}
              onChange={e => onChange({ weight_kg: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}

        {fields.reps && !useRange && (
          <SetField label="Reps" showLabel={showLabel}>
            <input
              type="number" inputMode="numeric" value={set.reps}
              onChange={e => onChange({ reps: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}

        {fields.reps && useRange && (
          <SetField label="Rep range" showLabel={showLabel} wide>
            <div className="flex items-center gap-1">
              <input
                type="number" inputMode="numeric" value={set.rep_range_start}
                onChange={e => onChange({ rep_range_start: e.target.value })}
                placeholder="min" className={inputCls}
              />
              <span className="text-xs text-ink-300 shrink-0">–</span>
              <input
                type="number" inputMode="numeric" value={set.rep_range_end}
                onChange={e => onChange({ rep_range_end: e.target.value })}
                placeholder="max" className={inputCls}
              />
            </div>
          </SetField>
        )}

        {fields.duration && (
          <SetField label="Sec" showLabel={showLabel}>
            <input
              type="number" inputMode="numeric" value={set.duration_seconds}
              onChange={e => onChange({ duration_seconds: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}

        {fields.distance && (
          <SetField label="Meters" showLabel={showLabel}>
            <input
              type="number" inputMode="numeric" value={set.distance_meters}
              onChange={e => onChange({ distance_meters: e.target.value })}
              placeholder="–" className={inputCls}
            />
          </SetField>
        )}
      </div>

      {/* Remove — fixed slot so columns stay aligned across rows */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <span className="text-[10px] leading-none h-[10px]" aria-hidden />
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-300 hover:text-red-500 transition-colors"
            aria-label={`Remove set ${index + 1}`}
          >
            ✕
          </button>
        ) : (
          <span className="min-h-[44px] min-w-[44px] block" aria-hidden />
        )}
      </div>
    </div>
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

  const [form, setForm] = useState<RoutineForm>(() =>
    initial
      ? routineToForm(initial)
      : { title: '', folder_id: '', notes: '', exercises: [] }
  )
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({})

  const typeById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of templates) m.set(t.id, t.type)
    return m
  }, [templates])

  function setTitle(v: string)    { setForm(f => ({ ...f, title: v })) }
  function setFolderId(v: string) { setForm(f => ({ ...f, folder_id: v })) }
  function setNotes(v: string)    { setForm(f => ({ ...f, notes: v })) }

  function addExercise(t: HevyExerciseTemplate) {
    setForm(f => ({ ...f, exercises: [...f.exercises, blankExercise(t)] }))
  }

  function removeExercise(key: string) {
    setForm(f => ({ ...f, exercises: f.exercises.filter(e => e._key !== key) }))
  }

  function patchExercise(exKey: string, patch: Partial<FormExercise>) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e => e._key === exKey ? { ...e, ...patch } : e),
    }))
  }

  function addSet(exKey: string) {
    setForm(f => ({
      ...f,
      exercises: f.exercises.map(e => {
        if (e._key !== exKey) return e
        const last = e.sets[e.sets.length - 1]
        const next: FormSet = last ? { ...last, _key: newKey() } : blankSet()
        return { ...e, sets: [...e.sets, next] }
      }),
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

      <div className="px-6 py-5 flex flex-col gap-6 overflow-y-auto max-h-[calc(90vh-8rem)]">
        {/* Title + folder */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
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
          {folders.length > 0 && (
            <div className="sm:w-44">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
                Folder
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
        </div>

        {/* Routine notes */}
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">
            Notes (optional)
          </label>
          <textarea
            value={form.notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Routine description or notes…"
            rows={2}
            className="w-full bg-cream-50 border border-ink-200 rounded-xl px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-y"
          />
        </div>

        {/* Exercises */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              Exercises ({form.exercises.length})
            </p>
          </div>

          {/* Add exercise search — kept at the top so it's never buried */}
          <div className="mb-3">
            <ExerciseSearch templates={templates} onSelect={addExercise} />
          </div>

          {form.exercises.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-ink-200 rounded-2xl text-ink-400">
              <p className="text-2xl mb-1">🏋️</p>
              <p className="text-sm font-medium text-ink-500">No exercises yet</p>
              <p className="text-xs">Search above to add your first exercise</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
              {form.exercises.map((ex, exIdx) => {
                const fields = setFieldsForType(typeById.get(ex.exercise_template_id))
                const detailsOpen = openDetails[ex._key] ?? false
                return (
                  <div key={ex._key} className="border border-ink-200 rounded-xl overflow-hidden">
                    {/* Exercise header */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-cream-50 border-b border-ink-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-ink-400 shrink-0">{exIdx + 1}</span>
                        <span className="text-sm font-semibold text-ink-800 truncate">{ex.title}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenDetails(o => ({ ...o, [ex._key]: !detailsOpen }))}
                          className={`min-h-[44px] px-2.5 rounded-lg text-xs font-medium transition-colors ${
                            detailsOpen ? 'text-accent-600 bg-accent-50' : 'text-ink-500 hover:bg-ink-50'
                          }`}
                          aria-expanded={detailsOpen}
                        >
                          ⚙ Details
                        </button>
                        <button
                          type="button"
                          onClick={() => removeExercise(ex._key)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors text-sm"
                          aria-label={`Remove ${ex.title}`}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Details: rest, rep-range toggle, superset, notes */}
                    {detailsOpen && (
                      <div className="px-3 py-3 bg-cream-50/60 border-b border-ink-100 flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-ink-500">Rest (sec)</span>
                            <input
                              type="number" inputMode="numeric" value={ex.rest_seconds}
                              onChange={e => patchExercise(ex._key, { rest_seconds: e.target.value })}
                              placeholder="e.g. 90" className={`${inputCls} !text-left`}
                            />
                          </label>
                          <label className="flex flex-col gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-ink-500">Superset group</span>
                            <input
                              type="number" inputMode="numeric" value={ex.superset_id}
                              onChange={e => patchExercise(ex._key, { superset_id: e.target.value })}
                              placeholder="none" className={`${inputCls} !text-left`}
                            />
                          </label>
                        </div>
                        {fields.reps && (
                          <label className="flex items-center gap-2 min-h-[44px] cursor-pointer border-t border-ink-100 pt-2">
                            <input
                              type="checkbox"
                              checked={ex.use_rep_range}
                              onChange={e => patchExercise(ex._key, { use_rep_range: e.target.checked })}
                              className="w-4 h-4 accent-accent-600"
                            />
                            <span className="text-xs font-medium text-ink-600">Use rep range instead of fixed reps</span>
                          </label>
                        )}
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold text-ink-500">Notes</span>
                          <textarea
                            value={ex.notes}
                            onChange={e => patchExercise(ex._key, { notes: e.target.value })}
                            placeholder="Exercise notes…"
                            rows={2}
                            className="w-full bg-cream-50 border border-ink-200 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 resize-y"
                          />
                        </label>
                      </div>
                    )}

                    {/* Sets */}
                    <div className="px-3 py-2.5 flex flex-col gap-1.5">
                      {ex.sets.map((s, sIdx) => (
                        <SetRow
                          key={s._key}
                          set={s}
                          index={sIdx}
                          fields={fields}
                          useRange={ex.use_rep_range}
                          canRemove={ex.sets.length > 1}
                          showLabel={sIdx === 0}
                          onChange={patch => updateSet(ex._key, s._key, patch)}
                          onRemove={() => removeSet(ex._key, s._key)}
                        />
                      ))}

                      <button
                        type="button"
                        onClick={() => addSet(ex._key)}
                        className="mt-1 self-start text-xs text-accent-600 font-semibold hover:text-accent-700 px-2 rounded-lg hover:bg-accent-50 min-h-[44px] transition-colors"
                      >
                        + Add set
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
          className="flex-1 min-h-[44px] bg-accent-600 text-white rounded-xl text-sm font-semibold hover:bg-accent-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        className="fixed inset-0 bg-ink-950/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-4xl bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
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
        className="fixed inset-0 bg-ink-950/30 transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-4xl bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          {routine && (
            <RoutineFormContent title={`Edit: ${routine.title}`} onClose={onClose} initial={routine} />
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
