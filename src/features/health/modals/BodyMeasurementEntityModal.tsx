import type { EntityModalProps } from '../../../shared/modals/types'
import { BodyMeasurementForm } from '../components/body/BodyMeasurementForm'

/** `body-measurement`: log a Hevy body measurement, or edit one day's (`date`). The form reads that day fresh. */
export function BodyMeasurementEntityModal({ request, onClose }: EntityModalProps<'body-measurement'>) {
  return <BodyMeasurementForm fixedDate={request.date} onClose={onClose} />
}
