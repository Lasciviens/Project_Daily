import { useState, useEffect, useRef } from 'react'
import { useCreateSession, useUpdateSession, useSessionExercises, useSaveSessionExercises } from '../hooks/useTrainingSessions'
import { useCreateTimeBlock } from '../../daily/hooks/useSchedule'
import { useCreateTask } from '../../todo/hooks/useTodos'
import { fetchLastStrengthExercises, searchExerciseNames } from '../api/trainingApi'
import { ProgramPickerDialog } from './ProgramPickerDialog'
import { DateInput } from '../../../shared/components/DateInput'
import type { WorkoutType, Exercise, ExerciseSet, TrainingSession } from '../types'

const WORKOUT_TYPES: { value: WorkoutType; label: string; icon: string }[] = [
  { value: 'strength', label: 'Strength',  icon: '🏋️' },
  { value: 'run',      label: 'Run',       icon: '🏃' },
  { value: 'cycling',  label: 'Cycling',   icon: '🚴' },
  { value: 'walk',     label: 'Walk',      icon: '🚶' },
  { value: 'yoga',     label: 'Yoga',      icon: '🧘' },
  { value: 'swim',     label: 'Swim',      icon: '🏊' },
  { value: 'other',    label: 'Other',     icon: '💪' },
]

interface Props {
  defaultDate?: string
  session?:     TrainingSession   // when provided → edit mode
  onClose:      () => void
}

function emptySet(): ExerciseSet { return { reps: undefined, weight_kg: undefined } }
function emptyExercise(): Exercise { return { name: '', sets: [emptySet()] } }

// Converts stored seconds → display minutes string (rounded to 1 decimal)
function secsToMinStr(secs: number | null): string {
  if (secs == null) return ''
  const m = secs / 60
  return Number.isInteger(m) ? String(m) : m.toFixed(1)
}

// Converts stored meters → display km string
function metersToKmStr(m: number | null): string {
  if (m == null) return ''
  const km = m / 1000
  return Number.isInteger(km) ? String(km) : km.toFixed(2)
}

export function LogWorkoutModal({ defaultDate, session, onClose }: Props) {
  const editMode = !!session
  const today    = new Date().toISOString().slice(0, 10)

  // Pre-fill from session when editing, otherwise use defaults
  const [type,      setType]      = useState<WorkoutType>(session?.type ?? 'strength')
  const [title,     setTitle]     = useState(session?.title ?? '')
  const [date,      setDate]      = useState(session?.planned_date ?? defaultDate ?? today)
  const [notes,     setNotes]     = useState(session?.notes ?? '')
  const [markDone,  setMarkDone]  = useState(session ? !!session.completed_at : true)
  // Cardio fields — convert stored units back to display units
  const [distKm,    setDistKm]    = useState(metersToKmStr(session?.distance_meters ?? null))
  const [durMin,    setDurMin]    = useState(secsToMinStr(session?.duration_seconds ?? null))
  const [heartRate, setHeartRate] = useState(session?.avg_heart_rate != null ? String(session.avg_heart_rate) : '')
  const [elevGain,  setElevGain]  = useState(session?.elevation_gain_m != null ? String(session.elevation_gain_m) : '')
  // Strength exercises — loaded from session_exercises table in edit mode
  const [exercises, setExercises] = useState<Exercise[]>([emptyExercise()])
  const [exReady,   setExReady]   = useState(!editMode)

  const { data: savedExercises } = useSessionExercises(editMode && type === 'strength' ? session?.id : undefined)
  const saveExercises = useSaveSessionExercises()
  // autocomplete state: which exercise input is focused + search results
  const [acIdx,     setAcIdx]     = useState<number | null>(null)
  const [acResults, setAcResults] = useState<string[]>([])
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showProgramPicker, setShowProgramPicker] = useState(false)

  useEffect(() => {
    if (exReady || savedExercises === undefined) return
    setExercises(savedExercises.length > 0 ? savedExercises : [emptyExercise()])
    setExReady(true)
  }, [savedExercises, exReady])

  const create          = useCreateSession()
  const update          = useUpdateSession()
  const createTimeBlock = useCreateTimeBlock()
  const createTask      = useCreateTask()
  const isPending       = create.isPending || update.isPending
  const isCardio   = ['run', 'cycling', 'walk', 'swim'].includes(type)
  const isStrength = type === 'strength'

  function addExercise() {
    setExercises(ex => [...ex, emptyExercise()])
  }

  function removeExercise(idx: number) {
    setExercises(ex => ex.filter((_, i) => i !== idx))
  }

  function updateExerciseName(idx: number, name: string) {
    setExercises(ex => ex.map((e, i) => i === idx ? { ...e, name } : e))
    setAcIdx(idx)
    if (acTimer.current) clearTimeout(acTimer.current)
    acTimer.current = setTimeout(async () => {
      const results = await searchExerciseNames(name)
      setAcResults(results)
    }, 200)
  }

  function pickSuggestion(exIdx: number, name: string) {
    setExercises(ex => ex.map((e, i) => i === exIdx ? { ...e, name } : e))
    setAcIdx(null)
    setAcResults([])
  }

  function addSet(exIdx: number) {
    setExercises(ex => ex.map((e, i) => {
      if (i !== exIdx) return e
      const last = e.sets[e.sets.length - 1]
      return { ...e, sets: [...e.sets, { reps: last?.reps, weight_kg: last?.weight_kg }] }
    }))
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises(ex => ex.map((e, i) =>
      i === exIdx ? { ...e, sets: e.sets.filter((_, si) => si !== setIdx) } : e
    ))
  }

  function updateSet(exIdx: number, setIdx: number, field: keyof ExerciseSet, val: string) {
    const n = val === '' ? undefined : Number(val)
    setExercises(ex => ex.map((e, i) =>
      i === exIdx
        ? { ...e, sets: e.sets.map((s, si) => si === setIdx ? { ...s, [field]: n } : s) }
        : e
    ))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    const distM           = distKm   ? Math.round(parseFloat(distKm) * 1000) : undefined
    const durSec          = durMin   ? Math.round(parseFloat(durMin) * 60)   : undefined
    const paceSecPerKm    = distM && durSec ? Math.round(durSec / (distM / 1000)) : undefined
    const validExercises  = exercises.filter(e => e.name.trim())

    const payload = {
      type,
      title:               title.trim(),
      planned_date:        date || undefined,
      // Preserve original completed_at timestamp in edit mode when already done
      completed_at:        markDone ? (session?.completed_at ?? new Date().toISOString()) : undefined,
      notes:               notes.trim() || undefined,
      distance_meters:     distM,
      duration_seconds:    durSec,
      elevation_gain_m:    elevGain ? parseInt(elevGain) : undefined,
      avg_heart_rate:      heartRate ? parseInt(heartRate) : undefined,
      avg_pace_sec_per_km: paceSecPerKm,
    }

    if (editMode && session) {
      await update.mutateAsync({ id: session.id, patch: payload })
      if (isStrength) await saveExercises.mutateAsync({ sessionId: session.id, exercises: validExercises })
    } else {
      const newSession = await create.mutateAsync(payload)
      if (isStrength && newSession?.id) await saveExercises.mutateAsync({ sessionId: newSession.id, exercises: validExercises })
      // Auto-schedule new workouts on the day timeline at 17:00, 45 min
      if (date && newSession?.id) {
        createTimeBlock.mutate({
          date,
          title:            title.trim(),
          start_time:       '17:00:00',
          duration_minutes: 45,
          color:            'purple',
          source_type:      'training_session',
          source_id:        newSession.id,
        })
        // Create a task and link it back to the session
        const d = new Date(date + 'T00:00:00')
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const weekAhead = new Date(today); weekAhead.setDate(today.getDate() + 7)
        const taskSection = d <= today ? 'today' : d <= weekAhead ? 'this_week' : 'backlog'
        const { task } = await createTask.mutateAsync({
          title:    title.trim(),
          section:  taskSection,
          domain:   'personal',
          priority: 'medium',
          due_date: date,
        })
        // Persist the link session → task
        await update.mutateAsync({ id: newSession.id, patch: { linked_task_id: task.id } })
      }
    }
    onClose()
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center px-4 py-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-ink-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">{editMode ? 'Edit workout' : 'Log workout'}</h2>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-600 text-lg">×</button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Type selector */}
          <div className="flex flex-wrap gap-1.5">
            {WORKOUT_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors duration-150 min-h-[44px] ${
                  type === t.value
                    ? 'bg-accent-500 border-accent-500 text-white'
                    : 'border-ink-200 text-ink-600 hover:border-accent-400'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Workout title (e.g. Morning run, Chest day)"
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
            required
          />

          {/* Date + done toggle */}
          <div className="flex gap-3">
            <div className="flex-1">
              <DateInput
                value={date}
                onChange={setDate}
                className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-600 cursor-pointer">
              <input
                type="checkbox"
                checked={markDone}
                onChange={e => setMarkDone(e.target.checked)}
                className="accent-accent-500"
              />
              Done
            </label>
          </div>

          {/* Cardio metrics */}
          {isCardio && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium uppercase text-ink-400 block mb-1">Distance (km)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={distKm}
                  onChange={e => setDistKm(e.target.value)}
                  placeholder="5.00"
                  className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium uppercase text-ink-400 block mb-1">Duration (min)</label>
                <input
                  type="number" step="0.5" min="0"
                  value={durMin}
                  onChange={e => setDurMin(e.target.value)}
                  placeholder="30"
                  className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium uppercase text-ink-400 block mb-1">Avg HR (bpm)</label>
                <input
                  type="number" min="0"
                  value={heartRate}
                  onChange={e => setHeartRate(e.target.value)}
                  placeholder="145"
                  className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium uppercase text-ink-400 block mb-1">Elevation (m)</label>
                <input
                  type="number" min="0"
                  value={elevGain}
                  onChange={e => setElevGain(e.target.value)}
                  placeholder="120"
                  className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                />
              </div>
            </div>
          )}

          {/* Strength exercises */}
          {isStrength && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Exercises</p>
                <div className="flex gap-2">
                  {!editMode && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowProgramPicker(true)}
                        className="text-xs text-accent-600 hover:text-accent-700 font-medium"
                      >
                        📋 Program
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const last = await fetchLastStrengthExercises(undefined)
                          if (last.length) setExercises(last)
                        }}
                        className="text-xs text-ink-400 hover:text-ink-600"
                      >
                        ↺ Copy last
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={addExercise}
                    className="text-xs text-accent-600 hover:text-accent-700"
                  >
                    + Add exercise
                  </button>
                </div>
              </div>
              {exercises.map((ex, exIdx) => (
                <div key={exIdx} className="border border-ink-100 rounded-xl p-3 space-y-2">
                  <div className="flex gap-2 relative">
                    <div className="flex-1 relative">
                      <input
                        value={ex.name}
                        onChange={e => updateExerciseName(exIdx, e.target.value)}
                        onFocus={async () => {
                          setAcIdx(exIdx)
                          const results = await searchExerciseNames(ex.name)
                          setAcResults(results)
                        }}
                        onBlur={() => setTimeout(() => setAcIdx(null), 150)}
                        placeholder="Exercise name…"
                        className="w-full border border-ink-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                      />
                      {acIdx === exIdx && acResults.length > 0 && (
                        <ul className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-white border border-ink-200 rounded-lg shadow-md max-h-40 overflow-y-auto">
                          {acResults.map(name => (
                            <li
                              key={name}
                              onMouseDown={() => pickSuggestion(exIdx, name)}
                              className="px-3 py-2 text-sm text-ink-700 hover:bg-cream-50 cursor-pointer min-h-[44px] flex items-center"
                            >
                              {name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {exercises.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeExercise(exIdx)}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-red-400 text-sm flex-shrink-0"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {ex.sets.map((s, setIdx) => (
                    <div key={setIdx} className="flex items-center gap-2 min-h-[44px]">
                      <span className="text-[10px] text-ink-400 w-8 flex-shrink-0">S{setIdx + 1}</span>
                      <input
                        type="number" min="0"
                        value={s.reps ?? ''}
                        onChange={e => updateSet(exIdx, setIdx, 'reps', e.target.value)}
                        placeholder="Reps"
                        className="flex-1 min-w-0 border border-ink-200 rounded-lg px-2 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                      />
                      <span className="text-[10px] text-ink-300 flex-shrink-0">×</span>
                      <input
                        type="number" min="0" step="0.5"
                        value={s.weight_kg ?? ''}
                        onChange={e => updateSet(exIdx, setIdx, 'weight_kg', e.target.value)}
                        placeholder="kg"
                        className="flex-1 min-w-0 border border-ink-200 rounded-lg px-2 py-2 text-sm outline-none focus:border-accent-400 min-h-[44px]"
                      />
                      {ex.sets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSet(exIdx, setIdx)}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-300 hover:text-red-400 text-sm flex-shrink-0"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addSet(exIdx)}
                    className="text-[10px] text-accent-600 hover:text-accent-700"
                  >
                    + Add set
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-400 resize-none"
          />

          <button
            type="submit"
            disabled={isPending || !title.trim()}
            className="w-full btn-primary py-2"
          >
            {isPending ? 'Saving…' : (editMode ? 'Save changes' : 'Save workout')}
          </button>
        </form>
      </div>
    </div>

    {showProgramPicker && (
      <ProgramPickerDialog
        onLoad={loaded => { setExercises(loaded); setShowProgramPicker(false) }}
        onClose={() => setShowProgramPicker(false)}
      />
    )}
    </>
  )
}
