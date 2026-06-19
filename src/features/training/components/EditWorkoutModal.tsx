import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useProgramExercises, useSaveProgramExercises } from '../hooks/usePrograms'
import { searchExerciseNames } from '../api/trainingApi'
import type { ProgramWorkout } from '../types'

interface ExRow {
  exercise_name: string
  sets:          number
  min_reps:      number | null
  max_reps:      number | null
  notes:         string | null
}

function emptyRow(): ExRow {
  return { exercise_name: '', sets: 3, min_reps: null, max_reps: null, notes: null }
}

interface Props {
  workout:  ProgramWorkout
  onClose:  () => void
}

export function EditWorkoutModal({ workout, onClose }: Props) {
  const { data: saved } = useProgramExercises(workout.id)
  const save            = useSaveProgramExercises()

  const [rows,  setRows]  = useState<ExRow[]>([emptyRow()])
  const [ready, setReady] = useState(false)

  // Autocomplete state
  const [acIdx,     setAcIdx]     = useState<number | null>(null)
  const [acResults, setAcResults] = useState<string[]>([])
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (ready || saved === undefined) return
    setRows(saved.length > 0 ? saved.map(ex => ({
      exercise_name: ex.exercise_name,
      sets:          ex.sets,
      min_reps:      ex.min_reps,
      max_reps:      ex.max_reps,
      notes:         ex.notes,
    })) : [emptyRow()])
    setReady(true)
  }, [saved, ready])

  function updateRow(idx: number, patch: Partial<ExRow>) {
    setRows(r => r.map((row, i) => i === idx ? { ...row, ...patch } : row))
  }

  function numOrNull(v: string): number | null {
    const n = parseInt(v)
    return isNaN(n) ? null : n
  }

  function handleNameChange(idx: number, value: string) {
    updateRow(idx, { exercise_name: value })
    setAcIdx(idx)
    if (acTimer.current) clearTimeout(acTimer.current)
    acTimer.current = setTimeout(async () => {
      const results = await searchExerciseNames(value)
      setAcResults(results)
    }, 200)
  }

  async function handleFocus(idx: number, name: string) {
    setAcIdx(idx)
    const results = await searchExerciseNames(name)
    setAcResults(results)
  }

  function pickSuggestion(idx: number, name: string) {
    updateRow(idx, { exercise_name: name })
    setAcIdx(null)
    setAcResults([])
  }

  async function handleSave() {
    const valid = rows.filter(r => r.exercise_name.trim())
    const tid = toast.loading('Saving…')
    try {
      await save.mutateAsync({
        workoutId: workout.id,
        exercises: valid.map((r, i) => ({
          exercise_name: r.exercise_name.trim(),
          sort_order:    i,
          sets:          r.sets,
          min_reps:      r.min_reps,
          max_reps:      r.max_reps,
          notes:         r.notes?.trim() || null,
        })),
      })
      toast.dismiss(tid)
      toast.success('Saved ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid)
      toast.error((err as Error).message ?? 'Failed')
    }
  }

  return (
    <Dialog open onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="px-5 pt-5 pb-3 border-b border-ink-100 flex items-center justify-between sticky top-0 bg-white z-10">
            <div>
              <h2 className="text-base font-semibold text-ink-900">{workout.name}</h2>
              <p className="text-[11px] text-ink-400 mt-0.5">Exercise template · sets × rep range</p>
            </div>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-600 text-lg">×</button>
          </div>

          <div className="p-5 space-y-3">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_52px_60px_60px_44px] gap-1.5 px-1">
              <span className="text-[10px] uppercase tracking-wider text-ink-400">Exercise</span>
              <span className="text-[10px] uppercase tracking-wider text-ink-400 text-center">Sets</span>
              <span className="text-[10px] uppercase tracking-wider text-ink-400 text-center">Min</span>
              <span className="text-[10px] uppercase tracking-wider text-ink-400 text-center">Max</span>
              <span />
            </div>

            {rows.map((row, idx) => (
              <div key={idx} className="border border-ink-150 rounded-xl p-3 space-y-2 bg-cream-50/50">
                <div className="grid grid-cols-[1fr_52px_60px_60px_44px] gap-1.5 items-center">
                  {/* Exercise name with autocomplete */}
                  <div className="relative">
                    <input
                      value={row.exercise_name}
                      onChange={e => handleNameChange(idx, e.target.value)}
                      onFocus={() => handleFocus(idx, row.exercise_name)}
                      onBlur={() => setTimeout(() => setAcIdx(null), 150)}
                      placeholder="Exercise name…"
                      className="w-full border border-ink-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-accent-400 bg-white min-h-[44px]"
                    />
                    {acIdx === idx && acResults.length > 0 && (
                      <ul className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-white border border-ink-200 rounded-lg shadow-md max-h-40 overflow-y-auto">
                        {acResults.map(name => (
                          <li
                            key={name}
                            onMouseDown={() => pickSuggestion(idx, name)}
                            className="px-3 py-2 text-sm text-ink-700 hover:bg-cream-50 cursor-pointer min-h-[44px] flex items-center"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <input
                    type="number" min="1"
                    value={row.sets}
                    onChange={e => updateRow(idx, { sets: parseInt(e.target.value) || 1 })}
                    className="border border-ink-200 rounded-lg px-1.5 py-2 text-sm text-center outline-none focus:border-accent-400 bg-white min-h-[44px]"
                  />
                  <input
                    type="number" min="1"
                    value={row.min_reps ?? ''}
                    onChange={e => updateRow(idx, { min_reps: numOrNull(e.target.value) })}
                    placeholder="—"
                    className="border border-ink-200 rounded-lg px-1.5 py-2 text-sm text-center outline-none focus:border-accent-400 bg-white min-h-[44px]"
                  />
                  <input
                    type="number" min="1"
                    value={row.max_reps ?? ''}
                    onChange={e => updateRow(idx, { max_reps: numOrNull(e.target.value) })}
                    placeholder="—"
                    className="border border-ink-200 rounded-lg px-1.5 py-2 text-sm text-center outline-none focus:border-accent-400 bg-white min-h-[44px]"
                  />
                  <button
                    onClick={() => setRows(r => r.filter((_, i) => i !== idx))}
                    disabled={rows.length === 1}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-red-400 text-sm disabled:opacity-20"
                  >
                    ✕
                  </button>
                </div>
                <input
                  value={row.notes ?? ''}
                  onChange={e => updateRow(idx, { notes: e.target.value || null })}
                  placeholder="Notes — e.g. neutral grip, slow eccentric (optional)"
                  className="w-full border border-ink-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-accent-400 bg-white"
                />
              </div>
            ))}

            <button
              onClick={() => setRows(r => [...r, emptyRow()])}
              className="w-full py-3 border-2 border-dashed border-ink-200 rounded-xl text-sm text-accent-600 hover:border-accent-300 hover:bg-accent-50 transition-colors duration-150 min-h-[44px] font-medium"
            >
              + Add exercise
            </button>

            <button
              onClick={handleSave}
              disabled={save.isPending}
              className="w-full btn-primary py-2.5"
            >
              {save.isPending ? 'Saving…' : 'Save workout'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
