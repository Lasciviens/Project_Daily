import type { RecipeWithIngredients } from '../types'

export function RecipeCard({ recipe, onClick }: { recipe: RecipeWithIngredients; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-xl border border-ink-200 p-3 hover:shadow-md hover:border-accent-300 transition-shadow flex flex-col gap-1.5"
    >
      <p className="text-sm font-semibold text-ink-900 leading-snug line-clamp-2">{recipe.title}</p>
      {recipe.description && <p className="text-xs text-ink-400 line-clamp-2">{recipe.description}</p>}
      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
        <span className="text-[10px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded-full">🍽 {recipe.servings}</span>
        <span className="text-[10px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded-full">{recipe.ingredients.length} ing</span>
        {recipe.calories != null && (
          <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">{Math.round(recipe.calories)} kcal</span>
        )}
      </div>
    </button>
  )
}
