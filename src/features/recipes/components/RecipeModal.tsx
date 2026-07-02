import { useState, useEffect } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useCreateRecipe, useUpdateRecipe } from '../hooks/useRecipes'
import type { RecipeWithIngredients, IngredientDraft } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  recipe?: RecipeWithIngredients   // present → edit mode
}

const EMPTY_ROW: IngredientDraft = { name: '', quantity: null, unit: null, note: null }

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return isNaN(n) ? null : n
}

export function RecipeModal({ open, onClose, recipe }: Props) {
  const editMode = !!recipe
  const create = useCreateRecipe()
  const update = useUpdateRecipe()

  const [title,        setTitle]        = useState('')
  const [servings,     setServings]     = useState('1')
  const [ingredients,  setIngredients]  = useState<IngredientDraft[]>([{ ...EMPTY_ROW }])
  const [instructions, setInstructions] = useState('')
  const [description,  setDescription]  = useState('')
  const [calories,     setCalories]     = useState('')
  const [protein,      setProtein]      = useState('')
  const [carbs,        setCarbs]        = useState('')
  const [fat,          setFat]          = useState('')
  const [sourceUrl,    setSourceUrl]    = useState('')
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    if (!open) return
    if (recipe) {
      setTitle(recipe.title)
      setServings(String(recipe.servings))
      setIngredients(recipe.ingredients.length
        ? recipe.ingredients.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note }))
        : [{ ...EMPTY_ROW }])
      setInstructions(recipe.instructions ?? '')
      setDescription(recipe.description ?? '')
      setCalories(recipe.calories?.toString() ?? '')
      setProtein(recipe.protein_g?.toString() ?? '')
      setCarbs(recipe.carbs_g?.toString() ?? '')
      setFat(recipe.fat_g?.toString() ?? '')
      setSourceUrl(recipe.source_url ?? '')
    } else {
      setTitle(''); setServings('1'); setIngredients([{ ...EMPTY_ROW }])
      setInstructions(''); setDescription(''); setCalories(''); setProtein('')
      setCarbs(''); setFat(''); setSourceUrl('')
    }
  }, [open, recipe])

  function setRow(idx: number, patch: Partial<IngredientDraft>) {
    setIngredients(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function addRow()          { setIngredients(rows => [...rows, { ...EMPTY_ROW }]) }
  function removeRow(idx: number) { setIngredients(rows => rows.filter((_, i) => i !== idx)) }

  async function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    const input = {
      title, description: description.trim() || null, servings: Math.max(1, Number(servings) || 1),
      instructions: instructions.trim() || null,
      calories: numOrNull(calories), protein_g: numOrNull(protein), carbs_g: numOrNull(carbs), fat_g: numOrNull(fat),
      source_url: sourceUrl.trim() || null,
      ingredients: ingredients.filter(i => i.name.trim()),
    }
    setSaving(true)
    const tid = toast.loading('Saving…')
    try {
      if (editMode && recipe) await update.mutateAsync({ id: recipe.id, input })
      else                    await create.mutateAsync(input)
      toast.dismiss(tid); toast.success('Saved ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400'
  const macroCls = 'w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-2 text-sm text-center text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100 sticky top-0 bg-white z-10">
            <h2 className="text-base font-bold text-ink-900">{editMode ? 'Edit recipe' : 'New recipe'}</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Recipe title" autoFocus className={inputCls} />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (optional)" rows={2}
              className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-400" />

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Base servings</label>
              <input type="number" min="1" value={servings} onChange={e => setServings(e.target.value)} className="w-24 min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent-400" />
            </div>

            {/* Ingredients */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Ingredients</label>
              <div className="flex flex-col gap-1.5">
                {ingredients.map((row, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input value={row.quantity ?? ''} onChange={e => setRow(i, { quantity: numOrNull(e.target.value) })} placeholder="Qty" inputMode="decimal"
                      className="w-14 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent-400" />
                    <input value={row.unit ?? ''} onChange={e => setRow(i, { unit: e.target.value })} placeholder="Unit"
                      className="w-16 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400" />
                    <input value={row.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="Ingredient"
                      className="flex-1 min-w-0 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400" />
                    <button onClick={() => removeRow(i)} className="min-w-[36px] min-h-[36px] flex items-center justify-center text-ink-300 hover:text-red-400 text-sm flex-shrink-0">×</button>
                  </div>
                ))}
              </div>
              <button onClick={addRow} className="mt-2 text-xs text-accent-600 hover:text-accent-700 min-h-[36px]">+ Add ingredient</button>
            </div>

            {/* Instructions */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Instructions</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="One step per line…" rows={4}
                className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-400" />
            </div>

            {/* Macros per serving */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Per serving</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { v: calories, set: setCalories, ph: 'kcal' },
                  { v: protein,  set: setProtein,  ph: 'P (g)' },
                  { v: carbs,    set: setCarbs,    ph: 'C (g)' },
                  { v: fat,      set: setFat,      ph: 'F (g)' },
                ].map((m, i) => (
                  <input key={i} value={m.v} onChange={e => m.set(e.target.value)} placeholder={m.ph} inputMode="decimal" className={macroCls} />
                ))}
              </div>
            </div>

            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Source link (optional)" className={inputCls} />
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
            <button onClick={onClose} className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !title.trim()} className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50">
              {saving ? 'Saving…' : editMode ? 'Save changes' : 'Add recipe'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
