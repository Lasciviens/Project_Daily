import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, MetaLine, Truncate } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { ChipSelect } from '../../../shared/components/plan-modal/fields'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { toast } from '../../../app/store'
import { SLOT_OPTIONS } from './foodLogUtils'
import { FoodThumb } from './foodLogKit'
import { AmountField } from './AmountField'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useSetMealPlanEntry, useDeleteMealPlanEntry } from '../hooks/useMealPlan'
import { rankMatches } from '../foodSearch'
import { amountUnit } from '../foodBasket'
import { foodAmountModel, portionWord, recipeAmountModel } from '../foodAmount'
import { toGrams } from '../foodUnits'
import { plannedKcal } from '../mealPlanRows'
import type { PlannedMeal } from '../api/mealPlanApi'
import type { IngredientLibraryItem, MealSlot, MealPlanEntry, Recipe } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  Edit a PLANNED row (opened by id from a plan cell or Today's planned row).
//  A new plan is the logger's plan mode (FoodLogModal `plan`); Edit entry
//  can't take a planned row (it stores totals and says "After this: … left").
//  Laid out like Edit entry: what it is (a search over recipes and foods, or
//  a one-off line), the one amount control, its live kcal, then Meal and Day;
//  Remove · Cancel · Save. Planned rows count only once ticked as eaten.
// ─────────────────────────────────────────────────────────────────────────────

type Source = { kind: 'recipe'; id: string } | { kind: 'food'; id: string } | { kind: 'custom'; title: string }

interface Props {
  onClose:  () => void
  date:     string
  existing: PlannedMeal
}

/** A food's planned amount in its g / ml: "2 pcs" counts by its portion preset (as ticking it eaten does), none = its portion. */
function startGrams(e: MealPlanEntry, lib: IngredientLibraryItem | undefined): number {
  const grams = toGrams(e.ingredient_quantity, e.ingredient_unit ?? 'g')
  if (grams != null && grams > 0) return grams
  if (e.ingredient_quantity != null && lib?.serving_grams) return e.ingredient_quantity * lib.serving_grams
  return lib?.serving_grams ?? 100
}

function startSource(e: MealPlanEntry): Source {
  if (e.recipe_id) return { kind: 'recipe', id: e.recipe_id }
  if (e.library_ingredient_id) return { kind: 'food', id: e.library_ingredient_id }
  return { kind: 'custom', title: e.custom_title ?? '' }
}

export function AssignMealModal({ onClose, date, existing }: Props) {
  const { data: recipes = [] } = useRecipes()
  const { data: library = [] } = useIngredientLibrary()
  const setEntry = useSetMealPlanEntry()
  const remove   = useDeleteMealPlanEntry()

  const [source, setSource] = useState<Source>(() => startSource(existing))
  const [slot, setSlot] = useState<MealSlot>(existing.meal_slot)
  const [day, setDay] = useState(date)
  const [amount, setAmount] = useState(() => (existing.recipe_id
    ? existing.servings || 1
    : startGrams(existing, library.find(l => l.id === existing.library_ingredient_id))))

  const recipe = source.kind === 'recipe' ? recipes.find(r => r.id === source.id) : undefined
  const lib = source.kind === 'food' ? library.find(l => l.id === source.id) : undefined
  const model = useMemo(() => (lib ? foodAmountModel(lib) : recipe ? recipeAmountModel(recipe, null) : null), [lib, recipe])
  const name = recipe?.title ?? lib?.name ?? (source.kind === 'custom' ? source.title : existing.recipe?.title ?? existing.ingredient?.name ?? '')
  const ownLine = source.kind === 'custom' && source.title === existing.custom_title
  const kcal = plannedKcal({
    recipe_id: recipe?.id ?? null, servings: amount, recipe,
    library_ingredient_id: lib?.id ?? null, ingredient_quantity: amount, ingredient_unit: 'g', ingredient: lib,
    calories: ownLine ? existing.kcal : null,
  })
  const sub = recipe
    ? [recipe.is_temp ? 'Saved meal' : 'Recipe', recipe.calories != null && `${Math.round(recipe.calories)} kcal / ${portionWord(recipe.serving_label)}`]
    : lib ? ['Food', lib.calories != null && `${Math.round(lib.calories)} kcal / 100 ${amountUnit(lib.unit)}`]
    : ['One-off line']

  function pick(next: Source) {
    setSource(next)
    if (next.kind === 'recipe') setAmount(1)
    if (next.kind === 'food') setAmount(library.find(l => l.id === next.id)?.serving_grams ?? 100)
  }

  async function handleSave() {
    if (source.kind === 'custom' && !source.title.trim()) { toast.error('Type what you plan to eat'); return }
    if (source.kind !== 'custom' && !(amount > 0)) { toast.error('Enter an amount'); return }
    try {
      await setEntry.mutateAsync({
        id: existing.id, date: day, meal_slot: slot,
        recipe_id:             source.kind === 'recipe' ? source.id : null,
        custom_title:          source.kind === 'custom' ? source.title.trim() : null,
        library_ingredient_id: source.kind === 'food' ? source.id : null,
        ingredient_quantity:   source.kind === 'food' ? amount : null,
        ingredient_unit:       source.kind === 'food' ? amountUnit(lib?.unit) : null,
        servings:              source.kind === 'recipe' ? amount : 1,
      })
      onClose()
    } catch { return }   // the hook already toasted + logged
  }

  async function handleRemove() {
    const what = name || 'this planned meal'
    const result = await remove.run([existing.id], { title: `Remove “${what}” from the plan?`, done: `Removed ${what}` })
    if (result === 'deleted' || result === 'gone') onClose()
  }

  const busy = setEntry.isPending || remove.busy

  return (
    <ModalShell
      onClose={onClose}
      title="Edit planned meal"
      subtitle={formatWeekdayDate(day)}
      size="md"
      dismissible={!busy}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="mr-auto text-danger" onClick={handleRemove} loading={remove.busy} disabled={setEntry.isPending}>Remove</Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => { void handleSave() }} loading={setEntry.isPending} disabled={remove.busy}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <FoodThumb name={name || '?'} group={lib?.food_group} imageUrl={lib?.image_url ?? recipe?.image_url} size={44} />
          <div className="min-w-0 max-w-md flex-1">
            <WhatSearch name={name} recipes={recipes} foods={library} onPick={pick} />
            <MetaLine className="mt-0.5 text-meta text-fg-muted tabular-nums" items={sub} />
          </div>
        </div>

        {model && <AmountField key={`${source.kind}-${recipe?.id ?? lib?.id}`} model={model} value={amount} onChange={setAmount} label="Amount" id="plan-amount" />}

        <p className="text-meta text-fg-muted tabular-nums">
          {kcal != null && <><span className="font-semibold text-fg-2">{Math.round(kcal)} kcal</span> planned · </>}
          Counts once you tick it eaten
        </p>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-line pt-3 text-meta text-fg-muted">
          <span className="flex items-center gap-1.5">Meal
            <ChipSelect label="Meal" value={slot} onChange={setSlot} options={SLOT_OPTIONS.map(o => ({ value: o.id, label: o.label }))} />
          </span>
          <span className="flex items-center gap-1.5">Day
            <DateInput value={day} onChange={v => { if (v) setDay(v) }} aria-label="Day" className="input input-sm h-8 w-[7.5rem] tabular-nums" />
          </span>
        </div>
      </div>
    </ModalShell>
  )
}

type Option = { key: string; source: Source; label: string; meta: string }

/** What is planned: typing searches recipes and foods; any text can also be a one-off line. */
function WhatSearch({ name, recipes, foods, onPick }: {
  name: string
  recipes: readonly Recipe[]
  foods: readonly IngredientLibraryItem[]
  onPick: (s: Source) => void
}) {
  const [query, setQuery] = useState('')
  const options = useMemo<Option[]>(() => {
    const q = query.trim()
    if (!q) return []
    const r = rankMatches([...recipes], q, x => x.title, 6).map(x => ({
      key: `r:${x.id}`, source: { kind: 'recipe', id: x.id } as Source, label: x.title,
      meta: [x.is_temp ? 'Saved meal' : 'Recipe', x.calories != null && `${Math.round(x.calories)} kcal / ${portionWord(x.serving_label)}`].filter(Boolean).join(' · '),
    }))
    const f = rankMatches([...foods], q, x => x.name, 8).map(x => ({
      key: `f:${x.id}`, source: { kind: 'food', id: x.id } as Source, label: x.name,
      meta: ['Food', x.calories != null && `${Math.round(x.calories)} kcal / 100 ${amountUnit(x.unit)}`].filter(Boolean).join(' · '),
    }))
    return [...r, ...f, { key: 'c', source: { kind: 'custom', title: q }, label: `“${q}”`, meta: 'As a one-off line — no ingredient saved' }]
  }, [recipes, foods, query])

  return (
    <Combobox value={null as Option | null} by="key" onChange={o => { if (o) onPick(o.source) }} onClose={() => setQuery('')}>
      <ComboboxInput
        aria-label="What is planned" placeholder="Search a recipe or food, or type a meal…" autoComplete="off"
        displayValue={() => name}
        onChange={e => setQuery(e.target.value)}
        className="input w-full font-semibold"
      />
      <ComboboxOptions anchor="bottom start" className="menu z-toast max-h-72 w-[var(--input-width)] min-w-[16rem] overflow-y-auto [--anchor-gap:4px] empty:invisible">
        {options.map(o => (
          <ComboboxOption key={o.key} value={o} className="menu-item min-h-[40px] flex-col !items-start !gap-0 py-1">
            <Truncate className="w-full text-body text-fg">{o.label}</Truncate>
            <span className="text-micro tabular-nums text-fg-muted">{o.meta}</span>
          </ComboboxOption>
        ))}
      </ComboboxOptions>
    </Combobox>
  )
}
