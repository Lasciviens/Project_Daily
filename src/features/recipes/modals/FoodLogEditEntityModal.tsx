import type { EntityModalProps } from '../../../shared/modals/types'
import { EditFoodLogModal, type EditableFoodEntry } from '../components/EditFoodLogModal'
import { useFoodLogEntry } from '../hooks/useFoodLog'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'
import type { LoggedFood } from '../api/foodLogApi'

function toEditable(row: LoggedFood): EditableFoodEntry {
  return {
    id: row.id,
    meal_slot: row.meal_slot,
    title: row.title,
    calories: row.calories, protein_g: row.protein_g, carbs_g: row.carbs_g, fat_g: row.fat_g,
    fiber_g: row.fiber_g, sugar_g: row.sugar_g,
    logEntry: {
      library_ingredient_id: row.library_ingredient_id,
      recipe_id: row.recipe_id,
      custom_title: row.custom_title,
      quantity: row.quantity,
      unit: row.unit,
    },
  }
}

/** `food-log-edit`: edit one diary row, loaded by id. */
export function FoodLogEditEntityModal({ request, onClose }: EntityModalProps<'food-log-edit'>) {
  const query = useFoodLogEntry(request.entryId)
  const row = useFirstLoaded(query.data, query)
  // The editor picks its form (grams / servings / typed macros) from the
  // source row on its first render: wait for that source, or a library row
  // would open as a custom one and save a title + rounded macros onto it.
  const library = useIngredientLibrary()
  const recipes = useRecipes()
  if (!row) return <EntityModalPending query={query} what="entry" size="sm" onClose={onClose} />
  if (row.library_ingredient_id && library.isLoading) return <EntityModalPending query={library} what="entry" size="sm" onClose={onClose} />
  if (row.recipe_id && recipes.isLoading) return <EntityModalPending query={recipes} what="entry" size="sm" onClose={onClose} />
  return <EditFoodLogModal meal={toEditable(row)} date={request.date} onClose={onClose} />
}
