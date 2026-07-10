import { useState } from 'react'
import type { RecipeWithIngredients } from '../types'

export function RecipeCard({ recipe, onClick }: { recipe: RecipeWithIngredients; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)
  const hasImage = !!recipe.image_url && !imgError

  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-xl border border-ink-200 overflow-hidden hover:shadow-md hover:border-accent-300 transition-shadow press-feedback flex flex-col"
    >
      {/* Cover image — falls back to a food-icon tile so cards stay uniform */}
      <div className="relative w-full aspect-[16/10] bg-cream-100 flex-shrink-0">
        {hasImage ? (
          <img
            src={recipe.image_url!}
            alt={recipe.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-40">🍽️</div>
        )}
        {recipe.times_cooked > 0 && (
          <span className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
            🔥 {recipe.times_cooked}×
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <p className="text-sm font-semibold text-ink-900 leading-snug line-clamp-2">{recipe.title}</p>
        {recipe.description && <p className="text-xs text-ink-400 line-clamp-2">{recipe.description}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
          <span className="text-[10px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded-full">🍽 {recipe.servings}</span>
          <span className="text-[10px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded-full">{recipe.ingredients.length} ing</span>
          {recipe.calories != null && (
            <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">{Math.round(recipe.calories)} kcal</span>
          )}
        </div>
      </div>
    </button>
  )
}
