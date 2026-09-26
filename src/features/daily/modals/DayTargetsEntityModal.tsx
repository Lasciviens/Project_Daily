import { ModalShell } from '../../../shared/modals/ModalShell'
import type { EntityModalProps } from '../../../shared/modals/types'
import { DayTargetsEditor } from '../components/DayTargetsEditor'

/** `day-targets`: the nutrition goals editor (draft → Save). */
export function DayTargetsEntityModal({ request, onClose }: EntityModalProps<'day-targets'>) {
  return (
    <ModalShell onClose={onClose} title="Nutrition goals" subtitle="Calories, protein and water per day" size="sm">
      <DayTargetsEditor date={request.date} onDone={onClose} />
    </ModalShell>
  )
}
