import { useState } from 'react'
import type { RecipeWithIngredients } from '../types'

export function RecipeCard({ recipe, onClick }: { recipe: RecipeWithIngredients; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)
  const hasImage = !!recipe.image_url && !imgError

  return (
    <button
      onClick={onClick}
      className="text-left bg-cream-50 rounded-xl border border-ink-200 overflow-hidden hover:shadow-md hover:border-accent-300 transition-shadow press-feedback flex flex-col"
    >
      {/* Cover image — falls back to a food-icon tile so cards stay uniform */}
      <div className="relative w-full aspect-[16/9] bg-cream-100 flex-shrink-0">
        {hasImage ? (
          <img
            src={recipe.image_url!}
            alt={recipe.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl opacity-40">🍽️</div>
        )}
        {recipe.times_cooked > 0 && (
          <span className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
            🔥 {recipe.times_cooked}×
          </span>
        )}
      </div>

      {/* Dense body — small cards per the width standard; the description
          lives in the detail view, not on the card. */}
      <div className="p-2 flex flex-col gap-1 flex-1">
        <p className="text-xs font-semibold text-ink-900 leading-snug line-clamp-2">{recipe.title}</p>
        <div className="flex items-center gap-1 flex-wrap mt-auto pt-0.5">
          {recipe.category && (
            <span className="text-[9px] bg-accent-50 text-accent-700 px-1.5 py-0.5 rounded-full capitalize">{recipe.category}</span>
          )}
          {recipe.calories != null && (
            <span className="text-[9px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">{Math.round(recipe.calories)} kcal</span>
          )}
          <span className="text-[9px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded-full">🍽 {recipe.servings}</span>
        </div>
      </div>
    </button>
  )
}
