import { useState } from 'react'
import { Flame, Plus, UtensilsCrossed } from 'lucide-react'
import { Card, IconButton, TonePill, Truncate } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { hasMacros, isHighProtein, proteinDensity, type Usage } from '../foodLibraryModel'
import { MacroBar } from './MacroBar'
import { MacroLine } from './MacroLine'
import type { RecipeWithIngredients } from '../types'

/**
 * A Library card: what one serving gives you (kcal, P/C/F and their split),
 * how protein-dense it is, and when you last ate it. Logging one serving is a
 * button beside the card's main tap target, never inside it.
 */
export function RecipeCard({ recipe, usage, usageDays, onOpen, onLog, logLabel }: {
  recipe: RecipeWithIngredients
  usage?: Usage
  usageDays: number
  onOpen: () => void
  onLog: () => void
  logLabel: string
}) {
  const [imgError, setImgError] = useState(false)
  const hasImage = !!recipe.image_url && !imgError
  const macros = hasMacros(recipe)
  const density = proteinDensity(recipe.calories, recipe.protein_g)
  const high = isHighProtein(recipe.calories, recipe.protein_g)

  return (
    <Card as="article" padded={false} className="flex flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="press-feedback flex flex-1 flex-col text-left">
        <div className="relative aspect-[16/9] w-full shrink-0 bg-surface-2">
          {hasImage ? (
            <img src={recipe.image_url!} alt="" onError={() => setImgError(true)} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="grid h-full w-full place-items-center text-fg-faint"><UtensilsCrossed aria-hidden className="h-6 w-6" /></div>
          )}
          {recipe.times_cooked > 0 && (
            <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-scrim/60 px-1.5 py-0.5 text-micro font-semibold text-white backdrop-blur-sm tabular-nums"
              title={`Cooked ${recipe.times_cooked}×`}>
              <Flame aria-hidden className="h-3 w-3" />{recipe.times_cooked}×
            </span>
          )}
          {recipe.category && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-scrim/60 px-1.5 py-0.5 text-micro font-semibold capitalize text-white backdrop-blur-sm">{recipe.category}</span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          <Truncate as="p" lines={2} className="text-body font-semibold leading-snug text-fg">{recipe.title}</Truncate>
          {macros ? (
            <>
              <p className="flex items-baseline gap-1 tabular-nums">
                <span className="text-lead font-semibold text-fg">{Math.round(recipe.calories!)}</span>
                <span className="text-meta text-fg-muted">kcal / serving</span>
              </p>
              <MacroLine protein={recipe.protein_g} carbs={recipe.carbs_g} fat={recipe.fat_g} />
              <MacroBar protein={recipe.protein_g} carbs={recipe.carbs_g} fat={recipe.fat_g} showLegend={false} />
              {density != null && (
                <span className="flex flex-wrap items-center gap-1">
                  {high && <TonePill tone="success">High protein</TonePill>}
                  <span className="text-micro tabular-nums text-fg-muted" title="Grams of protein per 100 kcal">{density} g / 100 kcal</span>
                </span>
              )}
            </>
          ) : (
            <TonePill tone="warn" className="self-start">No macros yet</TonePill>
          )}
        </div>
      </button>

      <div className="flex items-center gap-1 border-t border-line px-2.5 py-1">
        <span className="min-w-0 flex-1 text-micro text-fg-muted">
          {usage
            ? <>Last eaten <span className="tabular-nums">{formatDate(usage.lastDate)}</span>{usage.count > 1 && <> · <span className="tabular-nums">{usage.count}×</span></>}</>
            : <>Not eaten in {usageDays} days</>}
        </span>
        <IconButton label={logLabel} onClick={onLog} className="min-h-[44px] min-w-[44px] text-accent-600">
          <Plus />
        </IconButton>
      </div>
    </Card>
  )
}
