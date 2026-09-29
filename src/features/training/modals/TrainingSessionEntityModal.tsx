import type { EntityModalProps } from '../../../shared/modals/types'
import { TrainingSessionView } from '../components/session/TrainingSessionView'

/** `training-session`: one logged workout or one planned session, loaded by
 *  id (components/session/TrainingSessionView). Read-only; the plan is
 *  changed through its own editors, reached from the popup's ⋯ menu. The
 *  request itself is passed on (not a copy): its identity is how the popups
 *  it opens recognise it (sessionLinks.ts). */
export function TrainingSessionEntityModal({ request, onClose }: EntityModalProps<'training-session'>) {
  return <TrainingSessionView request={request} onClose={onClose} />
}
