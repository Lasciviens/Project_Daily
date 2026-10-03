import { useMemo } from 'react'
import { Plus, Target } from 'lucide-react'
import { Card, CardHeader, IconButton, Truncate } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries } from '../hooks/useFoodLog'
import { useFoodUsage } from '../hooks/useFoodUsage'
import { ingredientSnapshot, recipeSnapshot } from '../api/foodLogApi'
import { suggestForRemaining, type FitSuggestion } from '../foodLibraryModel'
import { slotForNow, SLOT_OPTIONS } from './foodLogUtils'

/**
 * "What fits what's left": your own recipes and foods whose one portion fits
 * the calories still open today and closes the most protein per kcal. One tap
 * logs it. Hidden when there is little protein or few calories left.
 */
export function FitsLeftCard({ date, kcalLeft, proteinLeft }: { date: string; kcalLeft: number; proteinLeft: number }) {
  const { data: recipes = [] } = useRecipes()
  const { data: foods = [] } = useIngredientLibrary()
  const { usage } = useFoodUsage()
  const add = useAddFoodLogEntries()
  const items = useMemo(
    () => suggestForRemaining({ recipes, foods, usage, kcalLeft, proteinLeft }),
    [recipes, foods, usage, kcalLeft, proteinLeft],
  )
  if (items.length === 0) return null
  const slot = date === todayStr() ? slotForNow() : 'snack'
  const slotName = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot

  function log(s: FitSuggestion) {
    if (s.kind === 'recipe') {
      const r = recipes.find(x => x.id === s.id)
      if (!r) return
      add.mutate([{ date, meal_slot: slot, recipe_id: r.id, quantity: 1, unit: 'serving', ...recipeSnapshot(r, 1) }])
    } else {
      const f = foods.find(x => x.id === s.id)
      if (!f) return
      const unit = f.unit?.trim().toLowerCase() === 'ml' ? 'ml' : 'g'
      add.mutate([{ date, meal_slot: slot, library_ingredient_id: f.id, quantity: s.quantity, unit, ...ingredientSnapshot(f, s.quantity) }])
    }
  }

  return (
    <Card>
      <CardHeader title="Fits what's left" variant="label" icon={<Target />}
        subtitle={`${Math.round(proteinLeft)} g protein and ${Math.round(kcalLeft)} kcal still open`} />
      <ul className="flex flex-col">
        {items.map(s => (
          <li key={s.key} className="flex min-h-[48px] items-center gap-2 border-b border-line last:border-b-0">
            <div className="min-w-0 flex-1">
              <Truncate className="text-body font-medium text-fg">{s.title}</Truncate>
              <p className="text-micro tabular-nums text-fg-muted">
                {s.portion} · {s.kcal} kcal · <span className="font-medium text-fg-2">{s.protein} g protein</span>
                {s.eaten > 0 && <> · eaten {s.eaten}×</>}
              </p>
            </div>
            <IconButton label={`Log ${s.title} to ${slotName}`} onClick={() => log(s)} className="min-h-[44px] min-w-[44px] text-accent-600"><Plus /></IconButton>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-micro text-fg-muted">Your own foods and recipes, ranked by protein per kcal. A tap logs one portion to {slotName}.</p>
    </Card>
  )
}
