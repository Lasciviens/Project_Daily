import { formatDurationBetween as fmtDuration } from '../../../shared/utils/formatDuration'
import { fmtTrainingDate as fmtDate, fmtTrainingTime as fmtTime } from '../dateFormat'
import { useDeleteTask } from '../../todo/hooks/useTodos'
import { Button } from '../../../shared/ui'
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
  const deleteTask    = useDeleteTask()

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[60px] w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        <div className="flex w-full items-start justify-between gap-3">
          <span className="truncate text-body font-semibold text-fg">{workout.title}</span>
          <span className="shrink-0 whitespace-nowrap text-body font-semibold tabular-nums text-fg-2">{duration}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-meta tabular-nums text-fg-muted">{date}{time ? ` · ${time}` : ''}</span>
          {exerciseCount !== null && (
            <span className="chip tabular-nums">{exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}</span>
          )}
        </div>

        {muscleGroups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {muscleGroups.map(mg => <span key={mg} className="chip capitalize">{mg}</span>)}
          </div>
        )}
      </button>

      {/* Manual-confirm fallback: a same-day planned training task that the
          server couldn't auto-close (freeform workout / routine mismatch). */}
      {matchedTask && (
        <div className="flex items-center gap-2 border-t border-line bg-surface-2 py-1.5 pl-4 pr-2">
          <span className="flex-1 truncate text-meta text-fg-2">
            Planned task: <strong className="text-fg">{matchedTask.title}</strong>
          </span>
          <Button size="sm" loading={deleteTask.isPending} onClick={() => deleteTask.mutate(matchedTask)} className="shrink-0">
            Close out
          </Button>
        </div>
      )}
    </div>
  )
}
