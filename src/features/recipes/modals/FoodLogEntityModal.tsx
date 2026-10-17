import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'
import { FoodLogModal } from '../components/FoodLogModal'
import { useMealGroupRows } from '../hooks/useMealGroups'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'

/**
 * `food-log`: the basket logger for a day (optionally a slot / a prefilled
 * search). With `groupId` it is Edit meal: the dish's rows, loaded by id, in
 * the basket — it waits for the foods and recipes too, so each row opens as
 * what it is (grams of a food, pieces of a recipe), never as a bare line.
 */
export function FoodLogEntityModal({ request, onClose }: EntityModalProps<'food-log'>) {
  if (!request.groupId) {
    return <FoodLogModal onClose={onClose} date={request.date} defaultSlot={request.slot} defaultQuery={request.query} />
  }
  return <EditMealModal groupId={request.groupId} date={request.date} onClose={onClose} />
}

function EditMealModal({ groupId, date, onClose }: { groupId: string; date: string; onClose: () => void }) {
  const query = useMealGroupRows(groupId)
  const rows = useFirstLoaded(query.data && query.data.length > 0 ? query.data : undefined, query)
  const library = useIngredientLibrary()
  const recipes = useRecipes()
  if (!rows) return <EntityModalPending query={query} what="meal" size="lg" onClose={onClose} />
  if (library.isLoading) return <EntityModalPending query={library} what="meal" size="lg" onClose={onClose} />
  if (recipes.isLoading) return <EntityModalPending query={recipes} what="meal" size="lg" onClose={onClose} />
  return <FoodLogModal onClose={onClose} date={rows[0]?.date ?? date} dish={{ groupId, rows }} />
}
