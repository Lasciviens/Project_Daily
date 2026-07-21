import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useUpdateFoodLogEntry, useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipes } from '../hooks/useRecipes'
import { ingredientSnapshot, recipeSnapshot } from '../api/foodLogApi'
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

const SLOTS: { id: MealSlot; label: string }[] = [
  { id: 'breakfast', label: '🌅 Breakfast' },
  { id: 'lunch', label: '☀️ Lunch' },
  { id: 'dinner', label: '🌙 Dinner' },
  { id: 'snack', label: '🍎 Snack' },
  { id: 'supplement', label: '💊 Supplement' },
]

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

interface Props { meal: DayMeal; date: string; onClose: () => void }

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
  const mExtra = meal as typeof meal & { fiber_g?: number | null; sugar_g?: number | null }
  const [fiber, setFiber] = useState(String(mExtra.fiber_g ?? ''))
  const [sugar, setSugar] = useState(String(mExtra.sugar_g ?? ''))

  const amt = Math.max(0, Number(sanitizeDecimal(amount)) || 0)
  const preview = kind === 'library' && lib ? ingredientSnapshot(lib, amt)
    : kind === 'recipe' && recipe ? recipeSnapshot(recipe, amt)
    : null

  async function handleSave() {
    let patch: Parameters<typeof update.mutateAsync>[0]['patch']
    if (kind === 'library' && lib) {
      if (amt <= 0) { toast.error('Enter grams'); return }
      patch = { meal_slot: slot, quantity: amt, unit: 'g', ...ingredientSnapshot(lib, amt) }
    } else if (kind === 'recipe' && recipe) {
      if (amt <= 0) { toast.error('Enter servings'); return }
      patch = { meal_slot: slot, quantity: amt, unit: 'serving', ...recipeSnapshot(recipe, amt) }
    } else {
      if (!title.trim()) { toast.error('Enter a name'); return }
      const n = (s: string) => (s.trim() === '' ? null : Number(sanitizeDecimal(s)))
      patch = { meal_slot: slot, custom_title: title.trim(), calories: n(kcal), protein_g: n(prot), carbs_g: n(carb), fat_g: n(fat), fiber_g: n(fiber), sugar_g: n(sugar) }
    }
    await update.mutateAsync({ id: meal.id, patch })
    onClose()
  }

  const inputCls = 'min-h-[44px] px-3 text-sm border border-ink-200 rounded-xl bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-sm max-h-[92vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="sm:hidden flex justify-center pt-2 -mb-1"><span className="h-1 w-10 rounded-full bg-ink-200" /></div>
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900 truncate pr-2">Edit · {meal.title}</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none shrink-0">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-3">
            {/* Slot */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Meal</label>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
                {SLOTS.map(s => (
                  <button key={s.id} type="button" onClick={() => setSlot(s.id)}
                    className={`shrink-0 whitespace-nowrap text-xs px-2.5 min-h-[36px] rounded-full border transition-colors ${
                      slot === s.id ? 'bg-accent-500 border-accent-500 text-white font-semibold' : 'border-ink-200 text-ink-600 hover:border-accent-300'
                    }`}>{s.label}</button>
                ))}
              </div>
            </div>

            {kind === 'library' && lib ? (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Amount ({lib.name})</label>
                <div className="flex items-center gap-2">
                  <input value={amount} onChange={e => setAmount(sanitizeDecimal(e.target.value))} inputMode="decimal" className={`${inputCls} w-24 text-right tabular-nums`} />
                  <span className="text-xs text-ink-400">g</span>
                  {lib.serving_grams != null && lib.serving_label && <span className="text-[11px] text-ink-400">≈ {Math.round((amt / lib.serving_grams) * 10) / 10}× {lib.serving_label}</span>}
                </div>
              </div>
            ) : kind === 'recipe' && recipe ? (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Servings ({recipe.title})</label>
                <input value={amount} onChange={e => setAmount(sanitizeDecimal(e.target.value))} inputMode="decimal" className={`${inputCls} w-24 text-right tabular-nums`} />
                {recipe.servings > 0 && <span className="text-[11px] text-ink-400 ml-2">{Math.round((amt / recipe.servings) * 100)}% of the batch</span>}
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1 block">Name</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} className={`${inputCls} w-full`} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    { v: kcal, set: setKcal, ph: 'kcal' },
                    { v: prot, set: setProt, ph: 'Prot' },
                    { v: carb, set: setCarb, ph: 'Carb' },
                    { v: fat, set: setFat, ph: 'Fat' },
                    { v: fiber, set: setFiber, ph: 'Fiber' },
                    { v: sugar, set: setSugar, ph: 'Sugar' },
                  ].map((m, i) => (
                    <input key={i} value={m.v} onChange={e => m.set(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder={m.ph}
                      className="min-h-[44px] px-2 text-sm text-center border border-ink-200 rounded-xl bg-cream-50 tabular-nums" />
                  ))}
                </div>
              </>
            )}

            {preview && (
              <p className="text-[11px] text-ink-500 tabular-nums">
                = <strong className="text-ink-800">{Math.round(preview.calories ?? 0)}</strong> kcal · {Math.round(preview.protein_g ?? 0)}g P · {Math.round(preview.carbs_g ?? 0)}g C · {Math.round(preview.fat_g ?? 0)}g F
              </p>
            )}
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
            <button onClick={() => del.mutate({ id: meal.id, date }, { onSuccess: onClose })}
              className="min-h-[44px] px-4 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl">Delete</button>
            <button onClick={handleSave} disabled={update.isPending}
              className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50">
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
