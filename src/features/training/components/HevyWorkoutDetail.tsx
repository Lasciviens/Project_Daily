import { ModalShell } from '../../../shared/modals/ModalShell'
import { Skeleton } from '../../../shared/ui'
import { useHevyWorkoutDetail } from '../hooks/useHevyWorkouts'
import { ExerciseThumb } from '../exerciseMedia'
import { formatDurationBetween as fmtDuration } from '../../../shared/utils/formatDuration'
import { fmtTrainingDateTime as fmtDateTime } from '../dateFormat'
import type { HevySet } from '../types.hevy'
import { SET_TYPE_META } from '../setTypeMeta'
import { anyRpe, formatRpe, formatSet } from '../setFormat'
import { RpeInfoBubble } from './RpeInfoBubble'

interface Props {
  /** null = closed (controlled callers); the `hevy-workout` entity modal always passes an id. */
  workoutId: string | null
  onClose: () => void
}

function SetTypeBadge({ type }: { type: HevySet['type'] }) {
  const cfg = SET_TYPE_META[type] ?? SET_TYPE_META.normal
  return (
    <span data-tone={cfg.tone} title={cfg.label} aria-label={cfg.label}
      className="tone-soft tone-text inline-flex h-5 w-5 items-center justify-center rounded text-micro font-bold">
      {cfg.short}
    </span>
  )
}

/** One exercise's sets. The RPE column appears only where a set of this
 *  exercise was rated in Hevy (never a column of dashes); `explainRpe` puts
 *  the RPE explainer on the first rated exercise of the workout. */
function SetTable({ sets, exerciseType, explainRpe }: { sets: HevySet[]; exerciseType?: string | null; explainRpe: boolean }) {
  const rated = anyRpe(sets)
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[280px] text-meta">
        <thead>
          <tr className="section-label">
            <th className="w-6 px-1 py-1.5 text-left font-semibold">#</th>
            <th className="w-8 px-1 py-1.5 text-left font-semibold">Type</th>
            <th className="px-1 py-1.5 text-left font-semibold">Set</th>
            {rated && (
              <th className="w-14 px-1 py-1.5 text-left font-semibold">
                <span className="inline-flex items-center gap-1">RPE{explainRpe && <RpeInfoBubble />}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sets.slice().sort((a, b) => a.index - b.index).map(set => (
            <tr key={set.id} className="border-t border-line tabular-nums">
              <td className="px-1 py-1.5 text-fg-muted">{set.index + 1}</td>
              <td className="px-1 py-1.5"><SetTypeBadge type={set.type} /></td>
              {/* Per exercise type: kg × reps, seconds, metres, assistance. */}
              <td className="px-1 py-1.5 text-fg-2">{formatSet(set, exerciseType)}</td>
              {rated && <td className="px-1 py-1.5 font-medium text-fg-2">{set.rpe != null ? formatRpe(set.rpe) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function HevyWorkoutDetail({ workoutId, onClose }: Props) {
  const { data: workout, isLoading } = useHevyWorkoutDetail(workoutId)
  const exercises = workout?.exercises?.slice().sort((a, b) => a.index - b.index) ?? []
  const firstRatedId = exercises.find(ex => anyRpe(ex.sets ?? []))?.id

  return (
    <ModalShell
      open={!!workoutId}
      onClose={onClose}
      size="lg"
      title={workout?.title ?? (isLoading ? 'Loading…' : 'Workout')}
      subtitle={workout ? [fmtDateTime(workout.start_time ?? workout.hevy_created_at), fmtDuration(workout.start_time ?? null, workout.end_time ?? null)].filter(Boolean).join(' · ') : undefined}
    >
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-12" />)}
        </div>
      )}

      {!isLoading && workout && exercises.length === 0 && (
        <p className="py-4 text-center text-body text-fg-muted">No exercise data</p>
      )}

      {!isLoading && exercises.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {exercises.map(ex => (
            <div key={ex.id} className="flex flex-col gap-2 md:rounded-card md:border md:border-line md:p-3">
              {/* Demo GIF (same fuzzy-match layer as Routines/Exercises — tap to enlarge). */}
              <div className="flex items-center gap-2.5">
                <ExerciseThumb title={ex.title} templateId={ex.exercise_template_id} size={44} />
                <div className="min-w-0">
                  <h3 className="text-body font-semibold text-fg">{ex.title}</h3>
                  {ex.notes && <p className="mt-0.5 text-meta text-fg-muted">{ex.notes}</p>}
                </div>
              </div>

              {ex.sets && ex.sets.length > 0 && (
                <SetTable sets={ex.sets} exerciseType={ex.template?.type} explainRpe={ex.id === firstRatedId} />
              )}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  )
}
