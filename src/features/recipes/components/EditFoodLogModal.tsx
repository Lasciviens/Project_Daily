import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { SlotSelect } from './foodLogKit'
import { sanitizeDecimal } from './foodLogUtils'
import { toast } from '../../../app/store'
import { useUpdateFoodLogEntry, useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { ingredientSnapshot, recipeSnapshot } from '../api/foodLogApi'
import { MacroWarningBadge } from './MacroWarningBadge'
import { checkMacroConsistency } from '../macroSanity'
import type { MealSlot } from '../types'
import type { DayMeal } from '../../daily/api/dayNutritionApi'

// ─────────────────────────────────────────────────────────────────────────────
//  Edit a DIARY row (food_log_entries) in place — the piece that was missing:
//  a logged item was delete-only. Edits re-snapshot at edit time (the diary
//  contract). Kind is inferred from which id the row carries:
//   • library ingredient → edit grams (re-snapshot per-100g × g)
//   • recipe            → edit servings (re-snapshot per-serving × n)
//   • custom            → edit title + macros directly
//  All kinds can move meal slot. Delete is available too.
// ─────────────────────────────────────────────────────────────────────────────

/** What the editor needs from a diary row — a DayMeal satisfies it, and the
 *  `food-log-edit` entity modal builds one from the row it loads by id. */
export type EditableFoodEntry = Pick<DayMeal, 'id' | 'meal_slot' | 'title' | 'logEntry'> & {
  calories:  number | null
  protein_g: number | null
  carbs_g:   number | null
  fat_g:     number | null
  fiber_g?:  number | null
  sugar_g?:  number | null
}

interface Props { meal: EditableFoodEntry; date: string; onClose: () => void }

export function EditFoodLogModal({ meal, date, onClose }: Props) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recipes = [] } = useRecipes()
  const update = useUpdateFoodLogEntry()
  const del = useDeleteFoodLogEntry()

  const le = meal.logEntry
  const lib = le?.library_ingredient_id ? library.find(l => l.id === le.library_ingredient_id) : undefined
  const recipe = le?.recipe_id ? recipes.find(r => r.id === le.recipe_id) : undefined
  // Only treat as library/recipe when we can actually re-snapshot; otherwise
  // fall back to editing the stored macros directly (custom-like).
  const kind: 'library' | 'recipe' | 'custom' = lib ? 'library' : recipe ? 'recipe' : 'custom'

  const [slot, setSlot] = useState<MealSlot>(meal.meal_slot)
  const [amount, setAmount] = useState(String(le?.quantity ?? (kind === 'recipe' ? 1 : 100)))
  const [title, setTitle] = useState(le?.custom_title ?? meal.title)
  const [kcal, setKcal] = useState(String(meal.calories ?? ''))
  const [prot, setProt] = useState(String(meal.protein_g ?? ''))
  const [carb, setCarb] = useState(String(meal.carbs_g ?? ''))
  const [fat, setFat] = useState(String(meal.fat_g ?? ''))
  const [fiber, setFiber] = useState(String(meal.fiber_g ?? ''))
  const [sugar, setSugar] = useState(String(meal.sugar_g ?? ''))

  const amt = Math.max(0, Number(sanitizeDecimal(amount)) || 0)
  const preview = kind === 'library' && lib ? ingredientSnapshot(lib, amt)
    : kind === 'recipe' && recipe ? recipeSnapshot(recipe, amt)
    : null

  async function handleSave() {
    let patch: Parameters<typeof update.mutateAsync>[0]['patch']
    if (kind === 'library' && lib) {
      if (amt <= 0) { toast.error('Enter grams'); return }
      // REAL BUG, fixed: this used to hardcode unit: 'g' regardless of the
      // library ingredient's own unit (some are 'ml') — editing such an
      // entry silently relabelled its stored unit, even though the macro
      // math itself (ingredientSnapshot) is unit-agnostic and unaffected.
      patch = { meal_slot: slot, quantity: amt, unit: lib.unit || 'g', ...ingredientSnapshot(lib, amt) }
    } else if (kind === 'recipe' && recipe) {
      if (amt <= 0) { toast.error('Enter servings'); return }
      patch = { meal_slot: slot, quantity: amt, unit: 'serving', ...recipeSnapshot(recipe, amt) }
    } else {
      if (!title.trim()) { toast.error('Enter a name'); return }
      const n = (s: string) => (s.trim() === '' ? null : Number(sanitizeDecimal(s)))
      patch = { meal_slot: slot, custom_title: title.trim(), calories: n(kcal), protein_g: n(prot), carbs_g: n(carb), fat_g: n(fat), fiber_g: n(fiber), sugar_g: n(sugar) }
    }
    try {
      await update.mutateAsync({ id: meal.id, patch })
      onClose()
    } catch { /* useMutationWithFeedback already toasts; this just avoids an unhandled rejection */ }
  }

  const saving = update.isPending || del.isPending

  return (
    <ModalShell
      onClose={onClose}
      title={`Edit · ${meal.title}`}
      size="sm"
      dismissible={!saving}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="text-danger" loading={del.isPending} disabled={update.isPending}
            onClick={() => del.mutate({ id: meal.id, date }, { onSuccess: onClose })}>
            Delete
          </Button>
          <Button variant="primary" block onClick={handleSave} loading={update.isPending} disabled={del.isPending}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Slot — same compact dropdown as the Log food screen */}
        <div className="flex items-center justify-between gap-2">
          <span className="field-label mb-0">Meal</span>
          <SlotSelect value={slot} onChange={setSlot} />
        </div>

        {kind === 'library' && lib ? (
          <div>
            <label htmlFor="efl-amount" className="field-label">Amount ({lib.name})</label>
            <div className="flex items-center gap-2">
              <input id="efl-amount" value={amount} onChange={e => setAmount(sanitizeDecimal(e.target.value))} inputMode="decimal" className="input w-24 text-right tabular-nums" />
              <span className="text-meta text-fg-muted">{lib.unit || 'g'}</span>
              {lib.serving_grams != null && lib.serving_label && (
                <span className="text-meta text-fg-muted tabular-nums">≈ {Math.round((amt / lib.serving_grams) * 10) / 10}× {lib.serving_label}</span>
              )}
            </div>
          </div>
        ) : kind === 'recipe' && recipe ? (
          <div>
            <label htmlFor="efl-servings" className="field-label">Servings ({recipe.title})</label>
            <div className="flex items-center gap-2">
              <input id="efl-servings" value={amount} onChange={e => setAmount(sanitizeDecimal(e.target.value))} inputMode="decimal" className="input w-24 text-right tabular-nums" />
              {recipe.servings > 0 && <span className="text-meta text-fg-muted tabular-nums">{Math.round((amt / recipe.servings) * 100)}% of the batch</span>}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="efl-name" className="field-label">Name</label>
              <input id="efl-name" value={title} onChange={e => setTitle(e.target.value)} className="input" />
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[
                { v: kcal, set: setKcal, ph: 'kcal' },
                { v: prot, set: setProt, ph: 'Protein' },
                { v: carb, set: setCarb, ph: 'Carbs' },
                { v: fat, set: setFat, ph: 'Fat' },
                { v: fiber, set: setFiber, ph: 'Fiber' },
                { v: sugar, set: setSugar, ph: 'Sugar' },
              ].map(m => (
                <input key={m.ph} value={m.v} onChange={e => m.set(sanitizeDecimal(e.target.value))} inputMode="decimal"
                  placeholder={m.ph} aria-label={m.ph} className="input text-center tabular-nums" />
              ))}
            </div>
            {(() => {
              const n = (v: string) => (v.trim() === '' ? null : Number(sanitizeDecimal(v)))
              const check = checkMacroConsistency(n(kcal), n(prot), n(carb), n(fat))
              return check?.inconsistent ? (
                <div data-tone="warn" className="tone-text flex items-center gap-1.5 text-meta">
                  <MacroWarningBadge result={check} />
                  <span>Calories don't match protein/carbs/fat — {check.deltaPct}% off. Tap the badge for details.</span>
                </div>
              ) : null
            })()}
          </>
        )}

        {preview && (
          <p className="text-meta text-fg-muted tabular-nums">
            = <strong className="text-fg">{Math.round(preview.calories ?? 0)}</strong> kcal · {Math.round(preview.protein_g ?? 0)}g protein · {Math.round(preview.carbs_g ?? 0)}g carbs · {Math.round(preview.fat_g ?? 0)}g fat
          </p>
        )}
      </div>
    </ModalShell>
  )
}
