import type { EntityModalProps } from '../../../shared/modals/types'
import { AssignMealModal } from '../components/AssignMealModal'
import { useMealPlanEntry } from '../hooks/useMealPlan'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'

/** `meal-plan`: plan a meal into a slot, or edit a planned row loaded by id. */
export function MealPlanEntityModal({ request, onClose }: EntityModalProps<'meal-plan'>) {
  const { date, slot, entryId } = request
  const query = useMealPlanEntry(entryId)
  const existing = useFirstLoaded(query.data, query)
  if (entryId && !existing) return <EntityModalPending query={query} what="planned meal" size="sm" onClose={onClose} />
  return (
    <AssignMealModal
      open onClose={onClose}
      date={existing?.date ?? date}
      mealSlot={existing?.meal_slot ?? slot}
      existing={existing ?? null}
    />
  )
}
