import type { EntityModalProps } from '../../../shared/modals/types'
import { FoodLogModal } from '../components/FoodLogModal'

/** `food-log`: the basket logger for a day (optionally a slot / a prefilled search). */
export function FoodLogEntityModal({ request, onClose }: EntityModalProps<'food-log'>) {
  return <FoodLogModal onClose={onClose} date={request.date} defaultSlot={request.slot} defaultQuery={request.query} />
}
