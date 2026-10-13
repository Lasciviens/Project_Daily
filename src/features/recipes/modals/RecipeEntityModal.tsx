import { useState } from 'react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { RecipeModal } from '../components/RecipeModal'
import { RecipeBuilder, type RecipeDraft } from '../components/RecipeBuilder'
import { useRecipe } from '../hooks/useRecipes'
import { EntityModalPending } from '../../../shared/modals/EntityModalPending'
import { useFirstLoaded } from '../../../shared/modals/useFirstLoaded'

/**
 * `recipe`: without `id` the quick builder (search foods, grams, save), whose
 * "All fields" hands its draft to the full form; with `id` the full editor.
 */
export function RecipeEntityModal({ request, onClose }: EntityModalProps<'recipe'>) {
  const query = useRecipe(request.id)
  const recipe = useFirstLoaded(query.data, query)
  const [fullForm, setFullForm] = useState<RecipeDraft | null>(null)
  if (request.id && !recipe) return <EntityModalPending query={query} what="recipe" size="lg" onClose={onClose} />
  if (!request.id && !fullForm) return <RecipeBuilder onClose={onClose} onMoreFields={setFullForm} />
  return <RecipeModal onClose={onClose} recipe={recipe} draft={fullForm ?? undefined} />
}
