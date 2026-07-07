import { formatDurationBetween as fmtDuration } from '../../../shared/utils/formatDuration'
import { fmtTrainingDate as fmtDate, fmtTrainingTime as fmtTime } from '../dateFormat'
import { useDeleteTask } from '../../todo/hooks/useTodos'
import type { HevyWorkout } from '../types.hevy'
import type { Task } from '../../todo/types'

interface Props {
  workout: HevyWorkout
  onClick: () => void
  /** Open planned-training-session task due the same day, when the server-side
   *  routine-id match couldn't auto-close one (freeform workout, or routine
   *  mismatch) — offers a manual "close it" fallback instead. */
  matchedTask?: Task
}

function getDayAccent(iso: string | null): string {
  if (!iso) return 'bg-ink-300'
  const day = new Date(iso).getDay()
  // Mon–Fri = accent, Sat–Sun = muted
  const colors = [
    'bg-ink-300',    // Sun
    'bg-accent-500', // Mon
    'bg-accent-400', // Tue
    'bg-accent-500', // Wed
    'bg-accent-400', // Thu
    'bg-accent-500', // Fri
    'bg-ink-300',    // Sat
  ]
  return colors[day] ?? 'bg-accent-400'
}

function getMuscleGroups(workout: HevyWorkout): string[] {
  if (!workout.exercises?.length) return []
  const seen = new Set<string>()
  const groups: string[] = []
  for (const ex of workout.exercises) {
    const mg = ex.template?.primary_muscle_group
    if (mg && !seen.has(mg)) {
      seen.add(mg)
      groups.push(mg)
    }
    if (groups.length >= 3) break
  }
  return groups
}

export function HevyWorkoutCard({ workout, onClick, matchedTask }: Props) {
  const muscleGroups  = getMuscleGroups(workout)
  const exerciseCount = workout.exercises?.length ?? null
  const duration      = fmtDuration(workout.start_time, workout.end_time)
  const date          = fmtDate(workout.start_time)
  const time          = fmtTime(workout.start_time)
  const accentBar     = getDayAccent(workout.start_time)
  const deleteTask    = useDeleteTask()

  return (
    <div className="rounded-xl border border-ink-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left min-h-[60px] cursor-pointer hover:bg-cream-50/60 transition-colors duration-150 flex overflow-hidden"
      >
        {/* Left accent bar */}
        <div className={`w-1 shrink-0 ${accentBar}`} />

        <div className="flex-1 px-3 py-2.5 flex flex-col gap-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-bold text-ink-900 truncate">{workout.title}</span>
            <span className="text-sm font-semibold text-ink-700 whitespace-nowrap shrink-0">{duration}</span>
          </div>

          {/* Date + exercise count */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-500">{date}{time ? ` · ${time}` : ''}</span>
            {exerciseCount !== null && (
              <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
              </span>
            )}
          </div>

          {/* Muscle group tags */}
          {muscleGroups.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {muscleGroups.map((mg, i) => (
                <span
                  key={mg}
                  className={`text-[11px] font-medium rounded-full px-2 py-0.5 capitalize ${
                    i === 0
                      ? 'bg-accent-100 text-accent-700'
                      : 'bg-ink-100 text-ink-500'
                  }`}
                >
                  {mg}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {/* Manual-confirm fallback: a same-day planned training task that the
          server couldn't auto-close (freeform workout / routine mismatch). */}
      {matchedTask && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-50 border-t border-accent-100">
          <span className="text-[11px] text-accent-700 flex-1 truncate">
            Planlı görev: <strong>{matchedTask.title}</strong>
          </span>
          <button
            type="button"
            onClick={() => deleteTask.mutate(matchedTask)}
            disabled={deleteTask.isPending}
            className="min-h-[32px] px-2.5 rounded-lg bg-accent-600 text-white text-[11px] font-semibold hover:bg-accent-700 transition-colors disabled:opacity-50 shrink-0"
          >
            Kapat
          </button>
        </div>
      )}
    </div>
  )
}
