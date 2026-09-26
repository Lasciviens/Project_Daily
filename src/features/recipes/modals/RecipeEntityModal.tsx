import type { EntityModalProps } from '../../../shared/modals/types'
import { RecipeModal } from '../components/RecipeModal'
import { useRecipe } from '../hooks/useRecipes'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'

/** `recipe`: the recipe editor — create without `id`, edit by id. */
export function RecipeEntityModal({ request, onClose }: EntityModalProps<'recipe'>) {
  const query = useRecipe(request.id)
  const recipe = useFirstLoaded(query.data, query)
  if (request.id && !recipe) return <EntityModalPending query={query} what="recipe" size="lg" onClose={onClose} />
  return <RecipeModal onClose={onClose} recipe={recipe} />
}
