import { ModalShell } from '../../../shared/modals/ModalShell'
import { Skeleton } from '../../../shared/ui'
import { useHevyWorkoutDetail } from '../hooks/useHevyWorkouts'
import { ExerciseThumb } from '../exerciseMedia'
import { formatDurationBetween as fmtDuration } from '../../../shared/utils/formatDuration'
import { fmtTrainingDateTime as fmtDateTime } from '../dateFormat'
import type { HevySet } from '../types.hevy'
import type { Tone } from '../../../shared/ui'

interface Props {
  /** null = closed (controlled callers); the `hevy-workout` entity modal always passes an id. */
  workoutId: string | null
  onClose: () => void
}

const SET_TYPE: Record<HevySet['type'], { label: string; name: string; tone: Tone }> = {
  warmup:  { label: 'W', name: 'Warm-up', tone: 'neutral' },
  normal:  { label: 'N', name: 'Normal',  tone: 'accent' },
  dropset: { label: 'D', name: 'Drop set', tone: 'info' },
  failure: { label: 'F', name: 'Failure', tone: 'danger' },
}

function SetTypeBadge({ type }: { type: HevySet['type'] }) {
  const cfg = SET_TYPE[type] ?? SET_TYPE.normal
  return (
    <span data-tone={cfg.tone} title={cfg.name} aria-label={cfg.name}
      className="inline-flex h-5 w-5 items-center justify-center rounded bg-[rgb(var(--tone-soft))] text-[10px] font-bold text-[rgb(var(--tone))]">
      {cfg.label}
    </span>
  )
}

export function HevyWorkoutDetail({ workoutId, onClose }: Props) {
  const { data: workout, isLoading } = useHevyWorkoutDetail(workoutId)
  const exercises = workout?.exercises?.slice().sort((a, b) => a.index - b.index) ?? []

  return (
    <ModalShell
      open={!!workoutId}
      onClose={onClose}
      size="lg"
      title={workout?.title ?? (isLoading ? 'Loading…' : 'Workout')}
      subtitle={workout ? `${fmtDateTime(workout.start_time ?? null)} · ${fmtDuration(workout.start_time ?? null, workout.end_time ?? null)}` : undefined}
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
                <div className="-mx-1 overflow-x-auto">
                  <table className="w-full min-w-[280px] text-meta">
                    <thead>
                      <tr className="section-label">
                        <th className="w-6 px-1 py-1.5 text-left font-semibold">#</th>
                        <th className="w-8 px-1 py-1.5 text-left font-semibold">Type</th>
                        <th className="px-1 py-1.5 text-left font-semibold">Weight × reps</th>
                        <th className="px-1 py-1.5 text-left font-semibold">RPE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.sets.slice().sort((a, b) => a.index - b.index).map(set => (
                        <tr key={set.id} className="border-t border-line tabular-nums">
                          <td className="px-1 py-1.5 text-fg-muted">{set.index + 1}</td>
                          <td className="px-1 py-1.5"><SetTypeBadge type={set.type} /></td>
                          <td className="px-1 py-1.5 text-fg-2">
                            {set.weight_kg !== null ? `${set.weight_kg} kg` : '—'}{' × '}{set.reps !== null ? set.reps : '—'}
                          </td>
                          <td className="px-1 py-1.5 text-fg-muted">{set.rpe !== null ? `RPE ${set.rpe}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  )
}
