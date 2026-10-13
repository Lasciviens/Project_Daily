import { hasMacros, isHighProtein, proteinDensity, type Usage } from '../foodLibraryModel'
import { LibraryCard } from './LibraryCard'
import type { RecipeWithIngredients } from '../types'

/** A Library recipe: what one serving gives you; + logs one serving. */
export function RecipeCard({ recipe, usage, onOpen, onLog, logLabel }: {
  recipe: RecipeWithIngredients
  usage?: Usage
  onOpen: () => void
  onLog: () => void
  logLabel: string
}) {
  const macros = hasMacros(recipe) ? {
    kcal: recipe.calories, protein: recipe.protein_g, carbs: recipe.carbs_g, fat: recipe.fat_g,
    density: proteinDensity(recipe.calories, recipe.protein_g), high: isHighProtein(recipe.calories, recipe.protein_g),
  } : null
  return (
    <LibraryCard title={recipe.title} imageUrl={recipe.image_url} macros={macros} usage={usage}
      meta={[
        macros && recipe.carbs_g != null && `${Math.round(recipe.carbs_g)} g carbs`,
        macros && recipe.fat_g != null && `${Math.round(recipe.fat_g)} g fat`,
      ]}
      onOpen={onOpen} onLog={onLog} logLabel={logLabel} />
  )
}
