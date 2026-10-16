import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'
import { useSupplementSchedule } from '../hooks/useSupplements'
import { SupplementScheduleSheet } from '../components/SupplementScheduleSheet'

/** `supplement-schedule`: a supplement schedule, loaded by id; without `id`, a new one. */
export function SupplementScheduleEntityModal({ request, onClose }: EntityModalProps<'supplement-schedule'>) {
  const query = useSupplementSchedule(request.id)
  const row = useFirstLoaded(query.data, query)
  if (!request.id) return <SupplementScheduleSheet schedule={null} title={request.defaults?.title} onClose={onClose} />
  if (!row) return <EntityModalPending query={query} what="schedule" onClose={onClose} />
  return <SupplementScheduleSheet schedule={row} onClose={onClose} />
}
