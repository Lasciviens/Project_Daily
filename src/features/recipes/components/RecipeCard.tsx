import { useState } from 'react'
import { Flame, UtensilsCrossed, Users } from 'lucide-react'
import { Card } from '../../../shared/ui'
import type { RecipeWithIngredients } from '../types'

export function RecipeCard({ recipe, onClick }: { recipe: RecipeWithIngredients; onClick: () => void }) {
  const [imgError, setImgError] = useState(false)
  const hasImage = !!recipe.image_url && !imgError

  return (
    <Card as="button" type="button" interactive padded={false} onClick={onClick} className="flex flex-col overflow-hidden">
      {/* Cover image — a neutral icon tile keeps cards uniform without one */}
      <div className="relative aspect-[16/9] w-full shrink-0 bg-surface-2">
        {hasImage ? (
          <img src={recipe.image_url!} alt="" onError={() => setImgError(true)} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center text-fg-faint"><UtensilsCrossed aria-hidden className="h-6 w-6" /></div>
        )}
        {recipe.times_cooked > 0 && (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-scrim/60 px-1.5 py-0.5 text-micro font-semibold text-white backdrop-blur-sm tabular-nums">
            <Flame aria-hidden className="h-3 w-3" />{recipe.times_cooked}×
          </span>
        )}
      </div>

      {/* Dense body; the description lives in the detail view. */}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <p className="line-clamp-2 text-body font-semibold leading-snug text-fg">{recipe.title}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1">
          {recipe.category && <span className="chip capitalize">{recipe.category}</span>}
          {recipe.calories != null && <span className="chip tabular-nums">{Math.round(recipe.calories)} kcal</span>}
          <span className="chip tabular-nums"><Users aria-hidden className="h-3 w-3" />{recipe.servings}</span>
        </div>
      </div>
    </Card>
  )
}
