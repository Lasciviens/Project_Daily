import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useCreateHevyExercise } from '../hooks/useHevyExerciseTemplates'
import {
  HEVY_EQUIPMENT, HEVY_EXERCISE_TYPES, HEVY_MUSCLE_GROUPS, HEVY_TITLE_MAX,
  customExercisePayload, equipmentLabel, exerciseTypeLabel, muscleLabel, type CustomExerciseForm,
} from '../hevyEnums'

const BLANK: CustomExerciseForm = { title: '', exerciseType: 'weight_reps', equipment: '', muscleGroup: '', otherMuscles: [] }

/**
 * Exercises → New exercise: a custom exercise made in Hevy (POST
 * /v1/exercise_templates with Hevy's own enums), then read back by id and
 * stored here, so it is in the library, the routine editor and the log form
 * at once. Hevy has no delete for it in its API: remove one in the Hevy app.
 */
export function CreateExerciseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateHevyExercise()
  const [form, setForm] = useState<CustomExerciseForm>(BLANK)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<CustomExerciseForm>) => { setForm(f => ({ ...f, ...patch })); setError(null) }
  const toggleOther = (m: string) => set({ otherMuscles: form.otherMuscles.includes(m) ? form.otherMuscles.filter(x => x !== m) : [...form.otherMuscles, m] })

  const close = () => { setForm(BLANK); setError(null); onClose() }
  async function submit() {
    const checked = customExercisePayload(form)
    if ('error' in checked) { setError(checked.error); return }
    try { await create.mutateAsync(checked.payload) } catch { return }
    close()
  }

  return (
    <ModalShell
      open={open}
      onClose={close}
      title="New exercise"
      subtitle="Made in Hevy, then added here"
      size="sm"
      dismissible={!create.isPending}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={close} disabled={create.isPending} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending} className="w-full sm:w-auto">Create exercise</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="new-exercise-title" className="field-label">Name</label>
          <input id="new-exercise-title" type="text" value={form.title} maxLength={HEVY_TITLE_MAX}
            onChange={e => set({ title: e.target.value })} placeholder="e.g. Cable Y Raise" className="input w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label htmlFor="new-exercise-type" className="field-label">Logged as</label>
            <select id="new-exercise-type" value={form.exerciseType} onChange={e => set({ exerciseType: e.target.value })} className="select w-full">
              {HEVY_EXERCISE_TYPES.map(t => <option key={t} value={t}>{exerciseTypeLabel(t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="new-exercise-equipment" className="field-label">Equipment</label>
            <select id="new-exercise-equipment" value={form.equipment} onChange={e => set({ equipment: e.target.value })} className="select w-full">
              <option value="" disabled>Pick…</option>
              {HEVY_EQUIPMENT.map(v => <option key={v} value={v}>{equipmentLabel(v)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="new-exercise-muscle" className="field-label">Main muscle</label>
            <select id="new-exercise-muscle" value={form.muscleGroup}
              onChange={e => set({ muscleGroup: e.target.value, otherMuscles: form.otherMuscles.filter(m => m !== e.target.value) })} className="select w-full">
              <option value="" disabled>Pick…</option>
              {HEVY_MUSCLE_GROUPS.map(v => <option key={v} value={v}>{muscleLabel(v)}</option>)}
            </select>
          </div>
        </div>
        <fieldset>
          <legend className="field-label">Other muscles <span className="font-normal text-fg-muted">(optional)</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {HEVY_MUSCLE_GROUPS.filter(m => m !== form.muscleGroup).map(m => (
              <button key={m} type="button" aria-pressed={form.otherMuscles.includes(m)} onClick={() => toggleOther(m)}
                className="chip px-2.5 py-1 aria-pressed:border-accent-500 aria-pressed:bg-accent-500 aria-pressed:text-on-accent">
                {muscleLabel(m)}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-meta text-danger">{error}</p>}
      </div>
    </ModalShell>
  )
}
