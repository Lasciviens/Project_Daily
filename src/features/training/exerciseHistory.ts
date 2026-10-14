// "History from Hevy" in the exercise popup: Hevy's own record of one
// exercise (GET /v1/exercise_history/{templateId} through hevy-api), one set
// per entry, grouped here by workout. Read live, never stored — the app's
// own sets (hevy_sets) feed Progress. Pure and import-free
// (scripts/verify-hevy-training.cjs).

/** One ExerciseHistoryEntry as hevy-api passes it on (checked there). */
export interface HevyHistorySet {
  workout_id: string
  workout_title: string
  workout_start_time: string
  workout_end_time: string | null
  weight_kg: number | null
  reps: number | null
  distance_meters: number | null
  duration_seconds: number | null
  rpe: number | null
  custom_metric: number | null
  /** warmup | normal | failure | dropset (null when Hevy sent none). */
  set_type: string | null
}

export interface HevyHistoryWorkout {
  workoutId: string
  title: string
  startTime: string
  sets: HevyHistorySet[]
}

/** Sets grouped by workout, newest workout first; each workout's sets keep
 *  Hevy's order (the entries carry no set index). */
export function groupExerciseHistory(entries: readonly HevyHistorySet[]): HevyHistoryWorkout[] {
  const byWorkout = new Map<string, HevyHistoryWorkout>()
  for (const e of entries) {
    const w = byWorkout.get(e.workout_id)
    if (w) w.sets.push(e)
    else byWorkout.set(e.workout_id, { workoutId: e.workout_id, title: e.workout_title, startTime: e.workout_start_time, sets: [e] })
  }
  return [...byWorkout.values()].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
}

export type HistoryRange = '3m' | '1y' | 'all'

export const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: '3m', label: '3 months' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All' },
]

/** The `start_date` sent to Hevy (none for All); ISO, to the day. */
export function historyStartDate(range: HistoryRange, now: Date): string | undefined {
  if (range === 'all') return undefined
  const d = new Date(now)
  if (range === '3m') d.setMonth(d.getMonth() - 3)
  else d.setFullYear(d.getFullYear() - 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
