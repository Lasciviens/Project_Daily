import type { EntityModalProps } from '../../../shared/modals/types'
import { EditFoodLogModal } from '../components/EditFoodLogModal'
import { useFoodLogEntry } from '../hooks/useFoodLog'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'

/** `food-log-edit`: edit one diary row, loaded by id. */
export function FoodLogEditEntityModal({ request, onClose }: EntityModalProps<'food-log-edit'>) {
  const query = useFoodLogEntry(request.entryId)
  const row = useFirstLoaded(query.data, query)
  // The editor picks its form (amount / typed macros) from the source row on
  // its first render: wait for that source, or a library row would open as a
  // custom one and save a title + rounded macros onto it.
  const library = useIngredientLibrary()
  const recipes = useRecipes()
  if (!row) return <EntityModalPending query={query} what="entry" onClose={onClose} />
  if (row.library_ingredient_id && library.isLoading) return <EntityModalPending query={library} what="entry" onClose={onClose} />
  if (row.recipe_id && recipes.isLoading) return <EntityModalPending query={recipes} what="entry" onClose={onClose} />
  return <EditFoodLogModal entry={row} onClose={onClose} />
}
