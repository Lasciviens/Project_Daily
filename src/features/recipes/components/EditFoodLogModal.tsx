import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Star } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Button, IconButton, MetaLine, Truncate, cx } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { ChipSelect } from '../../../shared/components/plan-modal/fields'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { toast } from '../../../app/store'
import { useAddFoodFavorite, useFoodFavorites, useRecentFoods, useRemoveFoodFavorite, useRemoveFoodLogEntries, useSaveFoodEntry } from '../hooks/useFoodLog'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useRecipeBatch, useRecipes } from '../hooks/useRecipes'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { groupDayMeals } from '../../daily/api/dayNutritionApi'
import { amountUnit, ingredientSnapshot, recipeSnapshot } from '../foodBasket'
import { foodAmountModel, portionWord, recipeAmountModel } from '../foodAmount'
import { macroAmounts, splitTitleQty } from '../foodIngredients'
import { proteinDensity } from '../foodLibraryModel'
import { lineToDraft } from '../quickGuess'
import { MACRO_COLOR } from '../macroColors'
import { checkMacroConsistency } from '../macroSanity'
import { AmountField } from './AmountField'
import { MacroBar } from './MacroBar'
import { MacroWarningBadge } from './MacroWarningBadge'
import { RecipeBatchPanel } from './RecipeBatch'
import { QuickGuessSheet } from './QuickGuessEditor'
import { DecimalInput, FoodThumb } from './foodLogKit'
import { SLOT_OPTIONS } from './foodLogUtils'
import type { EntrySave, FoodLogPatch, LoggedFood } from '../api/foodLogApi'
import type { MealSlot } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  Edit a DIARY row (food_log_entries) in place (Food point 6, 16.10.2026).
//  Kind is inferred from which id the row carries:
//   • library food → the shared AmountField (g / its preset, last time)
//   • recipe       → AmountField in its portion word / % / g, and what is
//                    left of the batch (this row left out of "eaten")
//   • one-off line → its name and labelled macro boxes, "Save as Quick guess"
//  Then the macros as tiles + bar, "After this: … left today", and where it
//  sits: Meal, Day and dish ("In") — moving it or joining / leaving a dish.
//  Save says what it did with Undo; Delete asks, then Undo.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  openfoodfacts: 'Open Food Facts', kassalapp: 'Kassalapp', dsld: 'NIH DSLD', matvaretabellen: 'Matvaretabellen',
}

const MACRO_FIELDS = [
  { key: 'calories', label: 'Calories (kcal)' },
  { key: 'protein_g', label: 'Protein (g)' },
  { key: 'carbs_g', label: 'Carbs (g)' },
  { key: 'fat_g', label: 'Fat (g)' },
  { key: 'fiber_g', label: 'Fiber (g)' },
  { key: 'sugar_g', label: 'Sugar (g)' },
] as const
type MacroField = typeof MACRO_FIELDS[number]['key']

const TILES = [
  { key: 'calories', unit: 'kcal', color: MACRO_COLOR.calories },
  { key: 'protein_g', unit: 'g protein', color: MACRO_COLOR.protein },
  { key: 'carbs_g', unit: 'g carbs', color: MACRO_COLOR.carbs },
  { key: 'fat_g', unit: 'g fat', color: MACRO_COLOR.fat },
  { key: 'fiber_g', unit: 'g fiber', color: MACRO_COLOR.fiber },
] as const

/** "none", a dish ("g:<group id>") or a single row to make a new dish with ("r:<row id>"). */
type DishChoice = string

/** A dish name short enough for the "In" chip (the native list it opens shows it the same). */
const cut = (s: string) => (s.length > 26 ? `${s.slice(0, 25).trimEnd()}…` : s)

interface Props { entry: LoggedFood; onClose: () => void }

export function EditFoodLogModal({ entry, onClose }: Props) {
  const navigate = useNavigate()
  const { data: library = [] } = useIngredientLibrary()
  const { data: recipes = [] } = useRecipes()
  const { data: recents = [] } = useRecentFoods()
  const { data: favorites = [] } = useFoodFavorites()
  const addFavorite = useAddFoodFavorite()
  const removeFavorite = useRemoveFoodFavorite()
  const save = useSaveFoodEntry()
  const del = useRemoveFoodLogEntries()
  const { targets } = useDayTargets()

  const lib = entry.library_ingredient_id ? library.find(l => l.id === entry.library_ingredient_id) : undefined
  const recipe = entry.recipe_id ? recipes.find(r => r.id === entry.recipe_id) : undefined
  // Only a source we can count from is edited by amount; anything else edits
  // its stored values directly (custom-like).
  const kind: 'library' | 'recipe' | 'custom' = lib ? 'library' : recipe ? 'recipe' : 'custom'

  // A taken supplement dose's line (160) keeps its day and slot (see the note below).
  const isDose = !!entry.supplement_schedule_id
  const [slot, setSlot] = useState<MealSlot>(entry.meal_slot)
  const [day, setDay] = useState(entry.date)
  const startDish: DishChoice = entry.meal_group_id ? `g:${entry.meal_group_id}` : 'none'
  const [dish, setDish] = useState<DishChoice>(startDish)
  const [amount, setAmount] = useState(entry.quantity && entry.quantity > 0 ? entry.quantity : kind === 'recipe' ? 1 : 100)
  const [title, setTitle] = useState(entry.custom_title ?? entry.title)
  const [macros, setMacros] = useState<Record<MacroField, number | null>>({
    calories: entry.calories, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g, fiber_g: entry.fiber_g, sugar_g: entry.sugar_g,
  })
  const [guessOpen, setGuessOpen] = useState(false)

  const batch = useRecipeBatch(recipe, entry.id)
  const model = useMemo(
    () => (lib ? foodAmountModel(lib) : recipe ? recipeAmountModel(recipe, batch) : null),
    [lib, recipe, batch],
  )

  // The row's new totals: from its source × the amount, or as typed.
  const next = kind === 'library' && lib ? ingredientSnapshot(lib, amount)
    : kind === 'recipe' && recipe ? recipeSnapshot(recipe, amount)
    : macros
  const nextExact = macroAmounts(next)

  // "After this": the day it will be on, without this row's current values when it is already on that day.
  const { data: dayNut } = useDayNutrition(day)
  const sameDay = day === entry.date
  const stored = macroAmounts(entry)
  const kcalLeft = Math.round(targets.calories - (dayNut?.calories ?? 0) + (sameDay ? stored.calories : 0) - nextExact.calories)
  const protLeft = Math.round(targets.protein - (dayNut?.protein_g ?? 0) + (sameDay ? stored.protein_g : 0) - nextExact.protein_g)
  const onWhen = day === todayStr() ? 'today' : `on ${formatDate(day)}`

  // The dishes (and single rows) in the picked meal of the picked day.
  const options = useMemo(() => {
    if (!dayNut) return null
    const inSlot = dayNut.meals.filter(m => m.source === 'log' && m.meal_slot === slot)
    return groupDayMeals(inSlot).flatMap(r => r.kind === 'group'
      ? [{ value: `g:${r.groupId}`, label: `${cut(r.title)} (${r.items.length})`, title: r.title }]
      : r.meal.id === entry.id ? [] : [{ value: `r:${r.meal.id}`, label: `With ${cut(splitTitleQty(r.meal.title).name)}`, title: r.meal.title }])
  }, [dayNut, slot, entry.id])
  // A dish that isn't in the picked meal and day can't be kept (the row moves out of it).
  const dishValue: DishChoice = !options ? dish : options.some(o => o.value === dish) ? dish : 'none'
  // A row left alone in its "dish" (a group of one shows as a plain row) is in
  // no dish as far as the owner can see: leaving it there is no change.
  const unmoved = slot === entry.meal_slot && day === entry.date
  const shownStart: DishChoice = options && unmoved && !options.some(o => o.value === startDish) ? 'none' : startDish

  // ★: the same favourite key as Recent (library id, recipe id, or the one-off title).
  const favKey = entry.library_ingredient_id ?? entry.recipe_id ?? `c:${(entry.custom_title ?? entry.title).toLowerCase()}`
  const isFavorite = favorites.some(f => f.key === favKey)
  function toggleFavorite() {
    if (isFavorite) { removeFavorite.mutate(favKey); return }
    addFavorite.mutate({
      key: favKey, title: entry.title, library_ingredient_id: entry.library_ingredient_id, recipe_id: entry.recipe_id,
      custom_title: entry.custom_title, quantity: kind === 'custom' ? entry.quantity : amount, unit: entry.unit,
      ...next, count: 0,
    })
  }
  const last = recents.find(r => r.key === favKey)?.quantity ?? null

  function editFood() {
    if (recipe) { entityModal.open({ kind: 'recipe', id: recipe.id }); return }
    if (lib) { onClose(); navigate(`/recipes?food=${lib.id}`) }
  }

  async function handleSave() {
    const patch: FoodLogPatch = isDose ? {} : { meal_slot: slot, date: day }
    let name: string
    if (kind === 'library' && lib) {
      if (!(amount > 0)) { toast.error('Enter an amount'); return }
      // The amount is grams/ml (the per-100g math assumes it), so only g / ml
      // is stored — a free-text library unit ("stk") would stop the row's
      // totals from ever being recalculated.
      Object.assign(patch, { quantity: amount, unit: amountUnit(lib.unit), ...ingredientSnapshot(lib, amount) })
      name = lib.name
    } else if (kind === 'recipe' && recipe) {
      if (!(amount > 0)) { toast.error('Enter an amount'); return }
      Object.assign(patch, { quantity: amount, unit: 'serving', ...recipeSnapshot(recipe, amount) })
      name = recipe.title
    } else {
      if (!title.trim()) { toast.error('Enter a name'); return }
      Object.assign(patch, { custom_title: title.trim(), ...macros })
      name = title.trim()
    }
    const s: EntrySave = { id: entry.id, patch }
    const option = options?.find(o => o.value === dishValue)
    let where = ''
    if (!isDose && dishValue !== shownStart) {
      if (dishValue === 'none') { patch.meal_group_id = null; patch.meal_group_title = null; if (unmoved) where = ' · out of its meal' }
      else if (dishValue.startsWith('g:')) { patch.meal_group_id = dishValue.slice(2); where = ` · in ${option?.title ?? 'the meal'}` }
      else { s.joinRowId = dishValue.slice(2); where = ` · with ${option?.title ?? 'it'}` }
    }
    const moved = !unmoved
    const slotWord = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot
    const done = `Saved ${name}${moved ? ` · moved to ${slotWord}${sameDay ? '' : ` on ${formatDate(day)}`}` : ''}${where}`
    try {
      await save.mutateAsync({ save: s, before: entry, done, name })
      onClose()
    } catch { /* useMutationWithFeedback already toasts */ }
  }

  const saving = save.isPending || del.busy
  const sub = kind === 'library' && lib
    ? [lib.source ? (SOURCE_LABEL[lib.source] ?? 'Your food') : 'Your food',
       lib.calories != null && `${Math.round(lib.calories)} kcal / 100 ${amountUnit(lib.unit)}`,
       proteinDensity(lib.calories, lib.protein_g) != null && `${proteinDensity(lib.calories, lib.protein_g)} g protein / 100 kcal`]
    : kind === 'recipe' && recipe
      ? [recipe.is_temp ? 'Saved meal' : 'Recipe',
         recipe.calories != null && `${Math.round(recipe.calories)} kcal / ${portionWord(recipe.serving_label)}`,
         proteinDensity(recipe.calories, recipe.protein_g) != null && `${proteinDensity(recipe.calories, recipe.protein_g)} g protein / 100 kcal`]
      : ['One-off line']
  const check = kind === 'custom' ? checkMacroConsistency(macros.calories, macros.protein_g, macros.carbs_g, macros.fat_g) : null
  const left = (n: number, unit: string) => (n >= 0 ? `${n}${unit} left` : `${-n}${unit} over`)

  return (
    <ModalShell
      onClose={onClose}
      title="Edit entry"
      size="md"
      dismissible={!saving}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="mr-auto text-danger" loading={del.busy} disabled={save.isPending}
            onClick={async () => { const r = await del.run([entry.id], { title: `Remove “${entry.title}”?`, done: `Removed ${entry.title}` }); if (r === 'deleted' || r === 'gone') onClose() }}>
            Delete
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => { void handleSave() }} loading={save.isPending} disabled={del.busy}>Save</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* What it is: photo, name, ★, Edit food; where it comes from and how dense it is. */}
        <div className="flex items-start gap-3">
          <FoodThumb name={kind === 'custom' ? title : entry.title} group={lib?.food_group} imageUrl={lib?.image_url ?? recipe?.image_url} size={44} />
          <div className="min-w-0 flex-1">
            {kind === 'custom'
              ? <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Name" className="input input-bare text-ui font-semibold" />
              : <Truncate as="p" className="text-ui font-semibold text-fg">{entry.title}</Truncate>}
            <MetaLine className="text-meta text-fg-muted tabular-nums" items={sub} />
          </div>
          <IconButton label={isFavorite ? 'Remove favourite' : 'Add favourite'} aria-pressed={isFavorite} onClick={toggleFavorite}
            className={cx('h-9 w-9', isFavorite ? 'text-star' : 'text-fg-faint hover:text-star')}>
            <Star className={cx(isFavorite && 'fill-current')} />
          </IconButton>
          {kind !== 'custom' && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={editFood} aria-label="Edit food"><span className="max-sm:hidden">Edit food</span></Button>}
        </div>

        {model ? (
          <AmountField model={model} value={amount} onChange={setAmount} last={last} batch={batch} label="Amount" id="efl-amount" />
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-3 gap-2">
              {MACRO_FIELDS.map(m => (
                <label key={m.key} className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-micro text-fg-muted">{m.label}</span>
                  <DecimalInput value={macros[m.key]} onValue={v => setMacros(x => ({ ...x, [m.key]: v }))} className="input input-sm px-2 text-right tabular-nums" />
                </label>
              ))}
            </div>
            {check?.inconsistent && (
              <div data-tone="warn" className="tone-text flex items-center gap-1.5 text-meta">
                <MacroWarningBadge result={check} />
                <span>Calories don't match protein, carbs and fat — {check.deltaPct}% off.</span>
              </div>
            )}
            <button type="button" onClick={() => setGuessOpen(true)} className={chipClass('quiet', 'self-start')}>+ Save as Quick guess</button>
          </div>
        )}

        {kind !== 'custom' && (
          <div className="grid grid-cols-5 gap-1.5">
            {TILES.map(t => (
              <div key={t.key} className="min-w-0 rounded-row bg-surface-2 px-1 py-1.5 text-center">
                <div className="text-ui font-bold text-fg tabular-nums">{Math.round(nextExact[t.key])}</div>
                <div className="flex items-center justify-center gap-1 text-micro text-fg-muted">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="truncate">{t.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><MacroBar protein={nextExact.protein_g} carbs={nextExact.carbs_g} fat={nextExact.fat_g} showLegend={false} /></div>
          <span className="shrink-0 text-meta text-fg-muted tabular-nums">sugar {Math.round(nextExact.sugar_g)} g</span>
        </div>
        {recipe && batch && <RecipeBatchPanel recipe={recipe} batch={batch} thisServings={amount} />}
        {/* Only once the picked day's totals are in: before that it would read the whole target as left. */}
        {dayNut && (targets.calories > 0 || targets.protein > 0) && (
          <p className="text-meta text-fg-muted tabular-nums">
            After this: <span className={cx(kcalLeft < 0 && 'text-danger')}>{left(kcalLeft, ' kcal')}</span> and <span className={cx(protLeft < 0 && 'text-danger')}>{left(protLeft, ' g protein')}</span> {onWhen}
          </p>
        )}

        {/* Where it sits: the meal, the day, the dish. A taken supplement dose's
            line stays on its day in Supplement: moving it would reopen that day's
            dose (and clash with a dose already taken there). */}
        {isDose ? (
          <p className="border-t border-line pt-3 text-meta text-fg-muted">
            A scheduled supplement dose — it stays in Supplement on {formatDate(entry.date)}.
          </p>
        ) : (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-line pt-3 text-meta text-fg-muted">
          <span className="flex items-center gap-1.5">Meal
            <ChipSelect label="Meal" value={slot} onChange={setSlot} options={SLOT_OPTIONS.map(o => ({ value: o.id, label: o.label }))} />
          </span>
          <span className="flex items-center gap-1.5">Day
            <DateInput value={day} onChange={v => { if (v) setDay(v) }} aria-label="Day" className="input input-sm h-8 w-[7.5rem] tabular-nums" />
          </span>
          <span className="flex min-w-0 max-w-full items-center gap-1.5">In
            <ChipSelect label="In (dish)" value={dishValue} onChange={setDish} options={[
              { value: 'none', label: 'No meal' },
              ...(options ?? (startDish !== 'none' ? [{ value: startDish, label: entry.meal_group_title ?? 'Its meal' }] : [])).map(o => ({ value: o.value, label: o.label })),
            ]} />
          </span>
        </div>
        )}
      </div>
      {guessOpen && (
        <QuickGuessSheet item={null} initial={lineToDraft({ title: title.trim() || entry.title, ...macros })} onClose={() => setGuessOpen(false)} />
      )}
    </ModalShell>
  )
}
