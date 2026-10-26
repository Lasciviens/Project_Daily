import type { EntityModalProps } from '../../../shared/modals/types'
import { AssignMealModal } from '../components/AssignMealModal'
import { FoodLogModal } from '../components/FoodLogModal'
import { useMealPlanEntry } from '../hooks/useMealPlan'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'

/**
 * `meal-plan`: without `entryId` it is the logger in plan mode (Plan lunch —
 * the same search, favourites, basket and amounts as Log food); with one, the
 * edit popup for that planned row, loaded by id.
 */
export function MealPlanEntityModal({ request, onClose }: EntityModalProps<'meal-plan'>) {
  if (!request.entryId) return <FoodLogModal plan onClose={onClose} date={request.date} defaultSlot={request.slot} />
  return <EditPlannedEntry entryId={request.entryId} date={request.date} onClose={onClose} />
}

function EditPlannedEntry({ entryId, date, onClose }: { entryId: string; date: string; onClose: () => void }) {
  const query = useMealPlanEntry(entryId)
  const existing = useFirstLoaded(query.data, query)
  // The popup picks its amount control from the food / recipe on its first
  // render: wait for them, as Edit entry does.
  const library = useIngredientLibrary()
  const recipes = useRecipes()
  if (!existing) return <EntityModalPending query={query} what="planned meal" onClose={onClose} />
  if (library.isLoading) return <EntityModalPending query={library} what="planned meal" onClose={onClose} />
  if (recipes.isLoading) return <EntityModalPending query={recipes} what="planned meal" onClose={onClose} />
  return <AssignMealModal key={existing.id} onClose={onClose} date={existing.date ?? date} existing={existing} />
}
