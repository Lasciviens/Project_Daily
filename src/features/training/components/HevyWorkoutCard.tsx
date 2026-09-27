import { formatDurationBetween as fmtDuration } from '../../../shared/utils/formatDuration'
import { fmtTrainingDate as fmtDate, fmtTrainingTime as fmtTime } from '../dateFormat'
import { useToggleTask } from '../../todo/hooks/useTodos'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { useEntityModal } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import type { HevyWorkoutListItem } from '../api/hevyApi'
import type { Task } from '../../todo/types'

interface Props {
  workout: HevyWorkoutListItem
  onClick: () => void
  /** Open planned-training-session task on the same day, when the server's
   *  routine-id match couldn't close one (freeform workout, or a different
   *  routine) — offered as a manual "mark it done". */
  matchedTask?: Task
}

export function HevyWorkoutCard({ workout, onClick, matchedTask }: Props) {
  const muscleGroups  = workout.muscle_groups ?? []
  const exerciseCount = workout.exercise_count ?? null
  const duration      = fmtDuration(workout.start_time, workout.end_time)
  const date          = fmtDate(workout.start_time ?? workout.hevy_created_at)
  const time          = fmtTime(workout.start_time)
  const toggleTask    = useToggleTask()
  const modal         = useEntityModal()

  // Marks the plan done instead of deleting it (it used to hard-delete the
  // task and, by cascade, its calendar block), so the calendar keeps the
  // session as planned-and-done.
  async function closeOut(task: Task) {
    const ok = await modal.confirm({
      title: `Mark “${task.title}” done?`,
      message: 'This workout covers that planned session. The task is marked done and the session stays on your calendar as done.',
      confirmLabel: 'Mark done',
    })
    if (!ok) return
    await withProgress(() => toggleTask.mutateAsync({ id: task.id, isDone: true }), { loading: 'Marking done…', success: 'Planned session marked done' })
  }

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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta tabular-nums text-fg-muted">{date}{time ? ` · ${time}` : ''}</span>
          {exerciseCount != null && exerciseCount > 0 && (
            <span className="chip tabular-nums">{exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}</span>
          )}
        </div>

        {muscleGroups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {muscleGroups.map(mg => <span key={mg} className="chip capitalize">{mg.replace(/_/g, ' ')}</span>)}
          </div>
        )}
      </button>

      {matchedTask && (
        <div className="flex items-center gap-2 border-t border-line bg-surface-2 py-1.5 pl-4 pr-2">
          <span className="flex-1 truncate text-meta text-fg-2">
            Planned: <strong className="text-fg">{matchedTask.title}</strong>
          </span>
          <Button size="sm" loading={toggleTask.isPending} onClick={() => void closeOut(matchedTask)} className="shrink-0">
            Mark done
          </Button>
        </div>
      )}
    </div>
  )
}
