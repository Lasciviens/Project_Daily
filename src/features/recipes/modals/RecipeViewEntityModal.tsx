import type { EntityModalProps } from '../../../shared/modals/types'
import { RecipeDetail } from '../components/RecipeDetail'
import { useRecipe } from '../hooks/useRecipes'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'

/**
 * `recipe-view`: read, scale, log and cook a recipe. Unlike an editor this
 * follows the live row (a "made it" count or an edit elsewhere shows up), and
 * Edit hands over to the `recipe` editor popup.
 */
export function RecipeViewEntityModal({ request, onClose }: EntityModalProps<'recipe-view'>) {
  const query = useRecipe(request.id)
  if (!query.data) return <EntityModalPending query={query} what="recipe" size="lg" onClose={onClose} />
  return <RecipeDetail recipe={query.data} onClose={onClose} />
}
