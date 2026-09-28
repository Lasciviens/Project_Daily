import type { EntityModalProps } from '../../../shared/modals/types'
import { TrainingSessionView } from '../components/session/TrainingSessionView'

/** `training-session`: one logged workout or one planned session, loaded by
 *  id (components/session/TrainingSessionView). Read-only; the plan is
 *  changed through its own editors, reached from the popup's ⋯ menu. */
export function TrainingSessionEntityModal({ request, onClose }: EntityModalProps<'training-session'>) {
  return <TrainingSessionView request={{ workoutId: request.workoutId, plan: request.plan }} onClose={onClose} />
}

/** `hevy-workout` — the old name, kept only so a caller not yet moved to
 *  `training-session` still opens the same popup. */
export function HevyWorkoutEntityModal({ request, onClose }: EntityModalProps<'hevy-workout'>) {
  return <TrainingSessionView request={{ workoutId: request.id }} onClose={onClose} />
}
