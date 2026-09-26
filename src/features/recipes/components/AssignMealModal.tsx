import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, SegmentedControl } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { SLOT_OPTIONS } from './foodLogUtils'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useSetMealPlanEntry, useDeleteMealPlanEntry } from '../hooks/useMealPlan'
import type { MealSlot, MealPlanEntry } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  date:      string
  mealSlot:  MealSlot
  existing?: MealPlanEntry | null
}

type Mode = 'recipe' | 'custom' | 'ingredient'

export function AssignMealModal({ open, onClose, date, mealSlot, existing }: Props) {
  const { data: recipes = [] }  = useRecipes()
  const { data: library = [] }  = useIngredientLibrary()
  const setEntry = useSetMealPlanEntry()
  const remove   = useDeleteMealPlanEntry()

  const [mode,        setMode]        = useState<Mode>('recipe')
  const [recipeId,    setRecipeId]    = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [ingredientId, setIngredientId] = useState('')
  const [ingredientQty, setIngredientQty] = useState('')
  const [ingredientUnit, setIngredientUnit] = useState('g')
  const [servings,    setServings]    = useState('1')

  // Prefill when the modal opens (or the edited entry changes). Adjusting
  // state during render on a prop change is React's recommended pattern over
  // a setState-in-effect (matches FoodLogModal).
  const [seed, setSeed] = useState<{ open: boolean; existing: MealPlanEntry | null }>({ open: false, existing: null })
  if (open !== seed.open || existing !== seed.existing) {
    setSeed({ open, existing: existing ?? null })
    if (open) {
      if (existing?.library_ingredient_id) {
        setMode('ingredient')
        setIngredientId(existing.library_ingredient_id)
        setIngredientQty(existing.ingredient_quantity != null ? String(existing.ingredient_quantity) : '')
        setIngredientUnit(existing.ingredient_unit ?? 'g')
      } else if (existing?.recipe_id) {
        setMode('recipe'); setRecipeId(existing.recipe_id)
      } else if (existing?.custom_title) {
        setMode('custom'); setCustomTitle(existing.custom_title)
      } else {
        setMode('recipe'); setRecipeId(''); setCustomTitle('')
        setIngredientId(''); setIngredientQty(''); setIngredientUnit('g')
      }
      setServings(String(existing?.servings ?? 1))
    }
  }

  async function handleSave() {
    if (mode === 'recipe' && !recipeId)           { toast.error('Pick a recipe'); return }
    if (mode === 'custom' && !customTitle.trim()) { toast.error('Type a title'); return }
    if (mode === 'ingredient' && !ingredientId)   { toast.error('Pick an ingredient'); return }
    try {
      await setEntry.mutateAsync({
        id: existing?.id,   // edit-in-place when present (was a broken upsert → 42P10)
        date, meal_slot: mealSlot,
        recipe_id:             mode === 'recipe'     ? recipeId : null,
        custom_title:          mode === 'custom'     ? customTitle.trim() : null,
        library_ingredient_id: mode === 'ingredient' ? ingredientId : null,
        ingredient_quantity:   mode === 'ingredient' ? Number(ingredientQty) || null : null,
        ingredient_unit:       mode === 'ingredient' ? (ingredientUnit.trim() || null) : null,
        servings:              Math.max(0.5, Number(servings) || 1),
      })
      onClose()
    } catch { return }   // the hook already toasted + logged
  }

  async function handleRemove() {
    if (!existing) return
    try {
      await remove.mutateAsync(existing.id)
      onClose()
    } catch { return }
  }

  const busy = setEntry.isPending || remove.isPending
  const slotLabel = SLOT_OPTIONS.find(o => o.id === mealSlot)?.label ?? mealSlot

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={existing ? `Edit planned ${slotLabel.toLowerCase()}` : `Plan ${slotLabel.toLowerCase()}`}
      size="sm"
      dismissible={!busy}
      footer={
        <div className="flex gap-2">
          {existing && (
            <Button variant="ghost" className="text-danger" onClick={handleRemove} loading={remove.isPending} disabled={setEntry.isPending}>Remove</Button>
          )}
          <Button variant="primary" block onClick={handleSave} loading={setEntry.isPending} disabled={remove.isPending}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl<Mode>
          fullWidth size="sm" value={mode} onChange={setMode}
          options={[
            { value: 'recipe', label: 'Recipe' },
            { value: 'ingredient', label: 'Ingredient' },
            { value: 'custom', label: 'Type it' },
          ]}
        />

        {mode === 'recipe' && (
          <>
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)} className="select" aria-label="Recipe">
              <option value="">Pick a recipe…</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <p className="text-meta text-fg-muted">
              Not in the list? Use{' '}
              <button type="button" onClick={() => setMode('custom')} className="font-semibold text-accent-600">Type it</button>
              {' '}for a quick one-off, or build it in Food → Library.
            </p>
          </>
        )}

        {mode === 'custom' && (
          <>
            <input autoFocus value={customTitle} onChange={e => setCustomTitle(e.target.value)} aria-label="Meal"
              placeholder="Type any meal — e.g. Restaurant, mom's köfte…" className="input" />
            <p className="text-meta text-fg-muted">Free text — plan anything, even if it's not a saved recipe. Confirm it as eaten later with ✓.</p>
          </>
        )}

        {mode === 'ingredient' && (
          <div className="flex flex-col gap-2">
            <select value={ingredientId} aria-label="Ingredient" onChange={e => {
              setIngredientId(e.target.value)
              const lib = library.find(l => l.id === e.target.value)
              if (lib) setIngredientUnit(lib.unit)
            }} className="select">
              <option value="">Pick from ingredient library…</option>
              {library.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {library.length === 0 && (
              <p className="text-meta text-fg-muted">No library foods yet — add one in the Food → Ingredients tab, or scan a barcode from "Log food".</p>
            )}
            <div className="flex gap-2">
              <input type="number" min="0" step="any" value={ingredientQty} onChange={e => setIngredientQty(e.target.value)}
                placeholder="Qty" aria-label="Quantity" className="input flex-1 text-center tabular-nums" />
              <input value={ingredientUnit} onChange={e => setIngredientUnit(e.target.value)}
                placeholder="Unit" aria-label="Unit" className="input w-20 text-center" />
            </div>
          </div>
        )}

        {mode !== 'ingredient' && (
          <div>
            <label htmlFor="amm-servings" className="field-label">Servings</label>
            <input id="amm-servings" type="number" min="0.5" step="0.5" value={servings} onChange={e => setServings(e.target.value)}
              className="input w-24 text-center tabular-nums" />
          </div>
        )}
      </div>
    </ModalShell>
  )
}
