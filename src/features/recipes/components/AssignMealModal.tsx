import { useState, useEffect } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useRecipes } from '../hooks/useRecipes'
import { useSetMealPlanEntry, useDeleteMealPlanEntry } from '../hooks/useMealPlan'
import type { MealSlot, MealPlanEntry } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  date:      string
  mealSlot:  MealSlot
  existing?: MealPlanEntry | null
}

const NO_RECIPE = '__custom__'

export function AssignMealModal({ open, onClose, date, mealSlot, existing }: Props) {
  const { data: recipes = [] } = useRecipes()
  const setEntry = useSetMealPlanEntry()
  const remove   = useDeleteMealPlanEntry()

  const [recipeId,    setRecipeId]    = useState(NO_RECIPE)
  const [customTitle, setCustomTitle] = useState('')
  const [servings,    setServings]    = useState('1')
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    if (!open) return
    setRecipeId(existing?.recipe_id ?? NO_RECIPE)
    setCustomTitle(existing?.recipe_id ? '' : (existing?.custom_title ?? ''))
    setServings(String(existing?.servings ?? 1))
  }, [open, existing])

  async function handleSave() {
    const usingRecipe = recipeId !== NO_RECIPE
    if (!usingRecipe && !customTitle.trim()) { toast.error('Pick a recipe or type a title'); return }
    setSaving(true)
    const tid = toast.loading('Saving…')
    try {
      await setEntry.mutateAsync({
        date, meal_slot: mealSlot,
        recipe_id:    usingRecipe ? recipeId : null,
        custom_title: usingRecipe ? null : customTitle.trim(),
        servings:     Math.max(0.5, Number(servings) || 1),
      })
      toast.dismiss(tid); toast.success('Saved ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!existing) return
    const tid = toast.loading('Removing…')
    try {
      await remove.mutateAsync(existing.id)
      toast.dismiss(tid); toast.success('Removed')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  const inputCls = 'w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-sm bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100">
            <h2 className="text-base font-bold text-ink-900 capitalize">{mealSlot}</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-3">
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)} className={inputCls}>
              <option value={NO_RECIPE}>No recipe — type a title…</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>

            {recipeId === NO_RECIPE && (
              <input value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="e.g. Eating out, Leftovers" className={inputCls} />
            )}

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Servings</label>
              <input type="number" min="0.5" step="0.5" value={servings} onChange={e => setServings(e.target.value)} className="w-24 min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent-400" />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
            {existing && (
              <button onClick={handleRemove} className="min-h-[44px] px-4 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl">Remove</button>
            )}
            <button onClick={handleSave} disabled={saving} className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
