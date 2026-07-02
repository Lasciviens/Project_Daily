import { useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useDeleteRecipe } from '../hooks/useRecipes'
import type { RecipeWithIngredients } from '../types'

interface Props {
  recipe: RecipeWithIngredients
  onClose: () => void
  onEdit: (recipe: RecipeWithIngredients) => void
}

// Scale a base quantity by the serving factor and print it cleanly (max 2
// decimals, trailing zeros stripped). null quantity = "to taste" → blank.
function scaledQty(q: number | null, factor: number): string {
  if (q == null) return ''
  const v = q * factor
  return (Math.round(v * 100) / 100).toString()
}

export function RecipeDetail({ recipe, onClose, onEdit }: Props) {
  const [servings, setServings] = useState(recipe.servings)
  const remove = useDeleteRecipe()
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1

  const macro = (perServing: number | null) =>
    perServing == null ? null : Math.round(perServing * servings)

  function handleDelete() {
    if (!confirm(`Delete "${recipe.title}"?`)) return
    const tid = toast.loading('Deleting…')
    remove.mutate(recipe.id, {
      onSuccess: () => { toast.dismiss(tid); toast.success('Deleted'); onClose() },
      onError:   e  => { toast.dismiss(tid); toast.error((e as Error).message) },
    })
  }

  const steps = (recipe.instructions ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  const totals = [
    { label: 'kcal', v: macro(recipe.calories) },
    { label: 'Protein', v: macro(recipe.protein_g), suffix: 'g' },
    { label: 'Carbs', v: macro(recipe.carbs_g), suffix: 'g' },
    { label: 'Fat', v: macro(recipe.fat_g), suffix: 'g' },
  ].filter(t => t.v != null)

  return (
    <Dialog open onClose={onClose} className="relative z-[65]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3 border-b border-ink-100 sticky top-0 bg-white z-10">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-ink-900 leading-snug">{recipe.title}</h2>
              {recipe.description && <p className="text-xs text-ink-400 mt-0.5">{recipe.description}</p>}
            </div>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl flex-shrink-0">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Serving scaler */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Servings</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setServings(s => Math.max(1, s - 1))} className="min-w-[36px] min-h-[36px] rounded-lg border border-ink-200 text-ink-600 hover:bg-cream-50">−</button>
                <span className="w-10 text-center text-sm font-bold text-ink-900 tabular-nums">{servings}</span>
                <button onClick={() => setServings(s => s + 1)} className="min-w-[36px] min-h-[36px] rounded-lg border border-ink-200 text-ink-600 hover:bg-cream-50">+</button>
              </div>
              {servings !== recipe.servings && (
                <button onClick={() => setServings(recipe.servings)} className="text-[11px] text-accent-600 hover:text-accent-700">reset</button>
              )}
            </div>

            {/* Macros (scaled to selected servings) */}
            {totals.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {totals.map(t => (
                  <div key={t.label} className="text-center bg-ink-50 rounded-lg py-2">
                    <div className="text-sm font-bold text-ink-900">{t.v}{t.suffix ?? ''}</div>
                    <div className="text-[10px] text-ink-400">{t.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Ingredients */}
            {recipe.ingredients.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Ingredients</label>
                <ul className="flex flex-col gap-1">
                  {recipe.ingredients.map(ing => (
                    <li key={ing.id} className="flex items-baseline gap-2 text-sm text-ink-800">
                      <span className="font-medium tabular-nums text-ink-900 min-w-[3rem]">
                        {scaledQty(ing.quantity, factor)} {ing.unit ?? ''}
                      </span>
                      <span className="flex-1">{ing.name}{ing.note ? <span className="text-ink-400"> · {ing.note}</span> : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Instructions */}
            {steps.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Instructions</label>
                <ol className="flex flex-col gap-2">
                  {steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-700">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-100 text-accent-700 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="flex-1 leading-snug">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {recipe.source_url && (
              <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-700 underline">Source ↗</a>
            )}
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
            <button onClick={handleDelete} className="min-h-[44px] px-4 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl">Delete</button>
            <button onClick={() => onEdit(recipe)} className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600">Edit</button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
