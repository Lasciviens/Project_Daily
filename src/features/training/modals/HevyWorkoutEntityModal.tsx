import type { EntityModalProps } from '../../../shared/modals/types'
import { HevyWorkoutDetail } from '../components/HevyWorkoutDetail'

/** `hevy-workout`: read-only detail of one logged workout (loads by id itself). */
export function HevyWorkoutEntityModal({ request, onClose }: EntityModalProps<'hevy-workout'>) {
  return <HevyWorkoutDetail workoutId={request.id} onClose={onClose} />
}
