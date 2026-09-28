import type { EntityModalProps } from '../../../shared/modals/types'
import { DayTargetsEditor } from '../components/DayTargetsEditor'

/** `day-targets`: "Your goal" — phase, daily targets and body targets (draft → Save). */
export function DayTargetsEntityModal({ request, onClose }: EntityModalProps<'day-targets'>) {
  return <DayTargetsEditor date={request.date} onClose={onClose} />
}
