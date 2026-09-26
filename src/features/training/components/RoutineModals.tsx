import { useMemo, useState } from 'react'
import { Dumbbell, Plus, SlidersHorizontal, X } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, EmptyState } from '../../../shared/ui'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyRoutineFolders, useCreateHevyRoutine, useUpdateHevyRoutine } from '../hooks/useHevyRoutines'
import {
  blankExercise, blankSet, formToPayload, newKey, routineToForm, setFieldsForType,
  type FormExercise, type FormSet, type RoutineForm,
} from '../routineForm'
import { ExerciseSearch, SetRow } from './RoutineFormParts'
import type { HevyRoutine, HevyExerciseTemplate } from '../types.hevy'

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
      return
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      title={title}
      size="xl"
      mobile="fullscreen"
      dismissible={!isLoading}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={isLoading} disabled={!form.title.trim()} className="w-full sm:w-auto">
            Save routine
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Title + folder */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="routine-title" className="field-label">Routine title</label>
            <input
              id="routine-title"
              type="text"
              value={form.title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Push Day A"
              className="input w-full"
            />
          </div>
          {folders.length > 0 && (
            <div className="sm:w-44">
              <label htmlFor="routine-folder" className="field-label">Folder</label>
              <select
                id="routine-folder"
                value={form.folder_id}
                onChange={e => setFolderId(e.target.value)}
                className="select w-full"
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
          <label htmlFor="routine-notes" className="field-label">Notes (optional)</label>
          <textarea
            id="routine-notes"
            value={form.notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Routine description or notes…"
            rows={2}
            className="input w-full resize-y py-2.5"
          />
        </div>

        {/* Exercises */}
        <div>
          <p className="field-label">Exercises ({form.exercises.length})</p>

          {/* Add exercise search — kept at the top so it's never buried */}
          <div className="mb-3">
            <ExerciseSearch templates={templates} onSelect={addExercise} />
          </div>

          {form.exercises.length === 0 ? (
            <EmptyState bordered icon={<Dumbbell />} title="No exercises yet" description="Search above to add your first exercise." className="py-10" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
              {form.exercises.map((ex, exIdx) => {
                const fields = setFieldsForType(typeById.get(ex.exercise_template_id))
                const detailsOpen = openDetails[ex._key] ?? false
                return (
                  <div key={ex._key} className="overflow-hidden rounded-card border border-line">
                    {/* Exercise header */}
                    <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 py-1 pl-3 pr-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 text-meta font-bold tabular-nums text-fg-faint">{exIdx + 1}</span>
                        <span className="truncate text-body font-semibold text-fg">{ex.title}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenDetails(o => ({ ...o, [ex._key]: !detailsOpen }))}
                          className={`btn-ghost btn-sm gap-1 px-2.5 text-meta ${detailsOpen ? '!bg-accent-50 !text-accent-700' : ''}`}
                          aria-expanded={detailsOpen}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Details
                        </button>
                        <button
                          type="button"
                          onClick={() => removeExercise(ex._key)}
                          className="icon-btn text-fg-faint hover:!text-danger"
                          aria-label={`Remove ${ex.title}`}
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </div>

                    {/* Details: rest, rep-range toggle, superset, notes */}
                    {detailsOpen && (
                      <div className="flex flex-col gap-3 border-b border-line px-3 py-3">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1 min-w-0">
                            <span className="text-meta font-semibold text-fg-muted">Rest (sec)</span>
                            <input
                              type="number" inputMode="numeric" value={ex.rest_seconds}
                              onChange={e => patchExercise(ex._key, { rest_seconds: e.target.value })}
                              placeholder="e.g. 90" className="input w-full"
                            />
                          </label>
                          <label className="flex flex-col gap-1 min-w-0">
                            <span className="text-meta font-semibold text-fg-muted">Superset group</span>
                            <input
                              type="number" inputMode="numeric" value={ex.superset_id}
                              onChange={e => patchExercise(ex._key, { superset_id: e.target.value })}
                              placeholder="none" className="input w-full"
                            />
                          </label>
                        </div>
                        {fields.reps && (
                          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 border-t border-line pt-2">
                            <input
                              type="checkbox"
                              checked={ex.use_rep_range}
                              onChange={e => patchExercise(ex._key, { use_rep_range: e.target.checked })}
                              className="h-4 w-4 accent-accent-500"
                            />
                            <span className="text-meta font-medium text-fg-2">Use rep range instead of fixed reps</span>
                          </label>
                        )}
                        <label className="flex flex-col gap-1">
                          <span className="text-meta font-semibold text-fg-muted">Notes</span>
                          <textarea
                            value={ex.notes}
                            onChange={e => patchExercise(ex._key, { notes: e.target.value })}
                            placeholder="Exercise notes…"
                            rows={2}
                            className="input w-full resize-y py-2"
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
                        className="btn-ghost btn-sm mt-1 self-start gap-1 px-2 text-meta !text-accent-600"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden /> Add set
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </ModalShell>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────
// The form mounts only while open, so each opening starts from fresh state.

export function NewRoutineModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return isOpen ? <RoutineFormContent title="New routine" onClose={onClose} /> : null
}

export function EditRoutineModal({ routine, onClose }: { routine: HevyRoutine | null; onClose: () => void }) {
  return routine ? <RoutineFormContent key={routine.id} title={`Edit: ${routine.title}`} onClose={onClose} initial={routine} /> : null
}
