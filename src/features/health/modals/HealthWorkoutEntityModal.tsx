import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending } from '../../../shared/modals'
import { useHealthWorkout } from '../hooks/useHealthExport'
import { HealthWorkoutDetail } from '../components/workout/HealthWorkoutDetail'

/** `health-workout`: one Apple Health workout, loaded by id with its raw payload (read-only). */
export function HealthWorkoutEntityModal({ request, onClose }: EntityModalProps<'health-workout'>) {
  const query = useHealthWorkout(request.id)
  if (!query.data) return <EntityModalPending query={query} what="workout" size="lg" onClose={onClose} />
  return <HealthWorkoutDetail workout={query.data} request={request} onClose={onClose} />
}
