import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Pencil, PenLine, Plus, Save, Star } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Button, Truncate } from '../../../shared/ui'
import { cx } from '../../../shared/ui/cx'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import {
  useLogWithUndo, usePlanWithUndo, useRecentFoods, useFoodFavorites, useAddFoodFavorite, useRemoveFoodFavorite, useHideRecentFood,
} from '../hooks/useFoodLog'
import { useRecipes, useCreateRecipe, useRecipeBatches } from '../hooks/useRecipes'
import { useSaveDishEdit } from '../hooks/useMealGroups'
import { recentToEntry, type LoggedFood, type RecentFood } from '../api/foodLogApi'
import { RecipePortionSheet } from './RecipePortionSheet'
import { SlotSelect, FoodThumb, FoodTile, BasketRow, FoodMatchRow, PortionBasketRow } from './foodLogKit'
import { SLOT_OPTIONS, sanitizeDecimal, slotForNow } from './foodLogUtils'
import { FoodSearchField } from './FoodSearchField'
import { NewFoodForm, type NewFoodSeed } from './NewFoodForm'
import { QuickAddCustom, type QuickAddValues } from './QuickAddCustom'
import { parseQuickAdd, rankMatches, sortForSlot } from '../foodSearch'
import {
  basketTotals, basketToRecipeInput, isCustomItem, isRecipeItem, itemAmount, itemMacros, itemMissingAmount, itemTitle,
  itemsToEntries, lastGrams, wholePortions, type LogItem,
} from '../foodBasket'
import { batchNote, countLabel, portionWord } from '../foodAmount'
import { dishName, rowToItem } from '../foodDish'
import { cleanServingLabel } from '../api/recipesApi'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { toast } from '../../../app/store'
import type { IngredientLibraryItem, MealSlot, RecipeWithIngredients } from '../types'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'

// ─────────────────────────────────────────────────────────────────────────────
//  LOG FOOD — full-screen, calm, visual (2026-07-21 redesign, user brief:
//  "baştan sona mükemmel bir UI/UX; basit, sade, şık; tam ekran; görselli").
//
//  Structure (ModalShell, full screen on phones — only the middle scrolls):
//    HEADER  title + date · slot dropdown
//    SEARCH  sticky at the top of the body: input with scan / online inline
//    BODY    idle → Favourites + Recents photo grids + Saved-meals strip
//            typing → clean result rows (+ create row)
//    FOOTER  basket (own scroll, appears when items exist) + totals · Log
//
//  Saves into food_log_entries (an eaten row's totals are derived from its
//  source — migration 106). A brand-new food is added to the library inline
//  ONCE and is a 3-tap food forever after; "Quick add" logs a one-off line
//  (title + calories) without creating an ingredient.
//
//  Food point 8 (16.10.2026): a saved meal opens the portion sheet (a stacked
//  sheet with the shared AmountField and what is left of the batch) — Log logs
//  it now, Add to meal puts "Køfte · 3 pieces" in the basket. A one-tap log
//  (Quick add, Log again, a recent tile, the sheet's Log) keeps the logger
//  open and says so with Undo; Done closes. Point 5: with `dish` it is Edit
//  meal — the dish's rows in the basket, Save writes them back (with Undo).
//  With `plan` it is Plan lunch (Meal plan's + / Add, 26.10.2026): the same
//  picker, saving planned rows (`usePlanWithUndo`) — Plan instead of Log, no
//  "As meal" and no "After: … left" (planned rows count only once ticked).
// ─────────────────────────────────────────────────────────────────────────────

/** Edit meal: the dish (a meal_group_id) and its rows, loaded by the entity modal. */
export interface DishToEdit { groupId: string; rows: LoggedFood[] }

interface Props {
  /** Controlled callers pass it; the `food-log` entity modal omits it. */
  open?:         boolean
  onClose:       () => void
  date:          string
  defaultSlot?:  MealSlot
  defaultQuery?: string
  /** ✎ on a saved meal. Defaults to the shared `recipe` editor popup. */
  onEditRecipe?: (r: RecipeWithIngredients) => void
  dish?:         DishToEdit
  /** Plan mode: the picked foods become planned rows of `date` (the `meal-plan` popup without an entry). */
  plan?:         boolean
}

const openRecipeEditor = (r: RecipeWithIngredients) => entityModal.open({ kind: 'recipe', id: r.id })

/** The basket a dish opens with: its rows as foods, portions and one-off lines. */
function dishBasket(dish: DishToEdit | undefined, library: IngredientLibraryItem[], recipes: RecipeWithIngredients[]): LogItem[] {
  if (!dish) return []
  const libById = new Map(library.map(l => [l.id, l]))
  const recById = new Map(recipes.map(r => [r.id, r]))
  return dish.rows.map(r => rowToItem(r, libById, recById))
}

export function FoodLogModal({ open = true, onClose, date, defaultSlot, defaultQuery, onEditRecipe = openRecipeEditor, dish, plan = false }: Props) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recents = [] } = useRecentFoods()
  const { data: favorites = [] } = useFoodFavorites()
  const { data: recipes = [] } = useRecipes()
  const createRecipe = useCreateRecipe()
  const logFood = useLogWithUndo()
  const planFood = usePlanWithUndo()
  // Both say what they did with Undo and take the same rows; plan mode plans them.
  const write = plan ? planFood : logFood
  const saveDish = useSaveDishEdit()
  const addFavorite = useAddFoodFavorite()
  const removeFavorite = useRemoveFoodFavorite()
  const hideRecent = useHideRecentFood()
  const { data: nut } = useDayNutrition(date)
  const { targets } = useDayTargets()

  const dishOwnName = dish?.rows.find(r => r.meal_group_title)?.meal_group_title ?? null
  const startSlot = (): MealSlot => dish?.rows[0]?.meal_slot ?? defaultSlot ?? slotForNow()
  const [slot, setSlot] = useState<MealSlot>(startSlot)
  const [query, setQuery] = useState(defaultQuery ?? '')
  const [mealName, setMealName] = useState('')
  const [mealServings, setMealServings] = useState('1')
  const [mealPortionName, setMealPortionName] = useState('')
  const [saveMealOpen, setSaveMealOpen] = useState(false)
  // A saved meal defaults to TEMP (a one-off named meal, hidden from the recipe
  // Library) — tick "Save to library" to make it a permanent Library recipe.
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  // The portion sheet: a saved meal to log or add, or (index) a basket portion to change.
  const [portion, setPortion] = useState<{ recipe: RecipeWithIngredients; index?: number; last?: number | null } | null>(null)
  // "As meal" — logging several basket items together collapses them into
  // ONE compact diary line (shared meal_group_id) instead of N separate rows;
  // tapping that line later expands to each item's own details. Default on:
  // the whole point is a fast multi-item lunch log that doesn't read as a
  // wall of separate rows in the day view.
  const [asMeal, setAsMeal] = useState(true)
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [recentOpen, setRecentOpen] = useState(true)
  // One-tap logs since the logger opened: the footer then offers Done.
  const [logged, setLogged] = useState(0)

  const [basket, setBasket] = useState<LogItem[]>(() => dishBasket(dish, library, recipes))
  // The new-food form's seed (a typed name or a scanned / online product);
  // a new seed remounts the form (`newFoodKey`).
  const [newFood, setNewFood] = useState<NewFoodSeed | null>(null)
  const [newFoodKey, setNewFoodKey] = useState(0)
  const openNewFood = (seed: NewFoodSeed) => { setNewFood(seed); setNewFoodKey(k => k + 1) }

  // Re-seed per open (instance is reused) — sanctioned adjust-during-render.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSlot(startSlot())
      setQuery(defaultQuery ?? '')
      setMealName(''); setMealServings('1'); setMealPortionName(''); setPortion(null); setSaveMealOpen(false)
      setBasket(dishBasket(dish, library, recipes)); setNewFood(null); setAsMeal(true); setLogged(0)
    }
  }

  /** A one-tap log (or plan): the logger stays open; the toast says what was done, with Undo. */
  function logNow(entries: Parameters<typeof logFood.mutate>[0]['entries'], what: string, after?: () => void) {
    write.mutate({ entries, what }, { onSuccess: () => { setLogged(n => n + 1); after?.() } })
  }

  function addRecent(r: RecentFood) {
    const lib = r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) : null
    // Add the amount the tile shows (the last one eaten), not the default portion.
    if (lib) { addToBasket(lib, lastGrams(r)); return }
    logNow([recentToEntry(r, date, slot)], r.title)
  }

  function openPortion(rec: RecipeWithIngredients) {
    const last = recents.find(r => r.recipe_id === rec.id)?.quantity ?? null
    setPortion({ recipe: rec, last })
  }

  function logPortion(rec: RecipeWithIngredients, servings: number) {
    const entries = itemsToEntries([{ kind: 'recipe', recipe: rec, servings }], { date, slot })
    logNow(entries, `${rec.title} · ${countLabel(servings, portionWord(rec.serving_label))}`, () => { setPortion(null); setQuery('') })
  }

  function putPortion(rec: RecipeWithIngredients, servings: number, index?: number) {
    setBasket(b => index != null
      ? b.map((it, i) => (i === index && isRecipeItem(it) ? { ...it, servings } : it))
      : [...b, { kind: 'recipe', recipe: rec, servings }])
    setPortion(null)
    setQuery('')
  }

  // A trailing amount ("chicken 150g") is not part of the name: search on the
  // name, and a picked food takes the typed grams.
  const quickParsed = useMemo(() => parseQuickAdd(query), [query])
  const searchText = quickParsed.title
  const q = searchText.trim().toLowerCase()
  // Ranked exact → starts with → word start → contains, accent-insensitive.
  const matches = useMemo(() => rankMatches(library, searchText, i => i.name, 20), [library, searchText])
  // Past one-off lines found by title (library rows are in `matches`, saved
  // meals in `savedMeals`), so a custom "Kebab" is searchable too.
  const pastMatches = useMemo(() => {
    const seen = new Set<string>()
    const pool = [...favorites, ...recents].filter(r => !r.library_ingredient_id && !r.recipe_id && !seen.has(r.key) && seen.add(r.key))
    return rankMatches(pool, searchText, r => r.title, 6)
  }, [favorites, recents, searchText])
  // Recents/Favourites enriched with their library row (photo / group / serving
  // preset) — Favourites don't store an image of their own, so this is how a
  // favourited library ingredient still gets a real photo instead of a
  // fallback emoji.
  const recentTiles = useMemo(
    () => sortForSlot(recents, slot).slice(0, 12).map(r => ({
      r, lib: r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) ?? null : null,
    })),
    [recents, library, slot],
  )
  const favoriteTiles = useMemo(
    () => favorites.map(r => ({
      r, lib: r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) ?? null : null,
    })),
    [favorites, library],
  )
  const favoriteKeys = useMemo(() => new Set(favorites.map(f => f.key)), [favorites])
  const savedMeals = useMemo(
    () => (searchText.trim() ? rankMatches(recipes, searchText, r => r.title, 8) : recipes.slice(0, 8)),
    [recipes, searchText],
  )
  // What is left of each listed saved meal's batch (one diary read).
  const batches = useRecipeBatches(savedMeals)
  const exactLibraryHit = matches.some(i => i.name.trim().toLowerCase() === q)
  // Quick add leads when the user typed calories or nothing else matched;
  // otherwise it waits under the real matches.
  const quickFirst = quickParsed.kcal != null || (matches.length === 0 && savedMeals.length === 0 && pastMatches.length === 0)

  function addToBasket(ing: IngredientLibraryItem, grams?: number) {
    setBasket(b => [...b, { ingredient: ing, grams: grams ?? ing.serving_grams ?? 100 }])
    setQuery('')
  }
  function setGrams(idx: number, raw: string) {
    const n = Number(sanitizeDecimal(raw))
    setBasket(b => b.map((it, i) => (i === idx && !('kind' in it) ? { ...it, grams: Number.isFinite(n) ? n : 0 } : it)))
  }

  const totals = basketTotals(basket)

  // Plan mode's one-off line: the typed name (and kcal, "kebab 700 kcal") as it is.
  function handlePlanTyped() {
    const title = quickParsed.title.trim()
    if (!title) return
    const kcal = quickParsed.kcal
    logNow([{ date, meal_slot: slot, custom_title: title, calories: kcal }], kcal != null ? `${title} · ${kcal} kcal` : title, () => setQuery(''))
  }

  function handleQuickAdd(v: QuickAddValues) {
    logNow(
      [{ date, meal_slot: slot, custom_title: v.title, calories: v.calories, protein_g: v.protein_g, carbs_g: v.carbs_g, fat_g: v.fat_g }],
      `${v.title} · ${Math.round(v.calories ?? 0)} kcal`,
      () => setQuery(''),
    )
  }

  const hasEmptyAmount = basket.some(itemMissingAmount)
  const dishShownName = dish ? dishName(dishOwnName, basket.map(itemTitle)) : null

  async function handleSave() {
    if (basket.length === 0) return
    if (hasEmptyAmount) { toast.warning('Enter an amount for every item'); return }
    if (dish) {
      try {
        await saveDish.mutateAsync({ groupId: dish.groupId, groupTitle: dishOwnName, date, slot, before: dish.rows, items: basket, name: dishShownName ?? 'the meal' })
        onClose()
      } catch { return }   // the hook already toasted + logged
      return
    }
    // A group of ONE has nothing to compact — only tag a shared id when
    // there's actually more than one item to collapse together. Planned rows
    // are never a dish.
    const groupId = !plan && asMeal && basket.length > 1 ? crypto.randomUUID() : null
    const what = basket.length > 1
      ? (groupId ? dishName(null, basket.map(itemTitle)) : `${basket.length} items`)
      : `${itemTitle(basket[0])} · ${itemAmount(basket[0])}`
    try {
      await write.mutateAsync({ entries: itemsToEntries(basket, { date, slot, groupId }), what })
      setBasket([])
      onClose()
    } catch { return }   // the hook already toasted + logged
  }

  async function handleSaveMeal() {
    if (basket.length === 0 || !mealName.trim()) return
    const servingsN = wholePortions(sanitizeDecimal(mealServings))
    try {
      // From weighed foods the save is 'from_ingredients': its macros follow
      // them on every later edit ('manual' froze the total forever). Saving
      // also starts a batch of that many portions (what is left is counted
      // from the diary, foodAmount.batchState).
      await createRecipe.mutateAsync(basketToRecipeInput(basket, mealName, servingsN, {
        is_temp: !saveToLibrary,
        serving_label: cleanServingLabel(mealPortionName),
        start_batch: servingsN,
      }))
      setMealName(''); setMealServings('1'); setMealPortionName(''); setSaveMealOpen(false); setSaveToLibrary(false)
    } catch { return }
  }

  const dateLabel = formatWeekdayDate(date)
  // A dish being edited is already in the day's totals: count only what changes.
  const already = dish ? basketTotals(dishBasket(dish, library, recipes)) : null
  const protLeft = Math.round(targets.protein - (nut?.protein_g ?? 0) - totals.protein + (already?.protein ?? 0))
  const kcalLeft = Math.round(targets.calories - (nut?.calories ?? 0) - totals.kcal + (already?.kcal ?? 0))
  const busy = write.isPending || saveDish.isPending
  const slotWord = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot
  const verb = plan ? 'Plan' : 'Log'

  const sectionToggle = (isOpen: boolean, onToggle: () => void, label: ReactNode) => (
    <button type="button" onClick={onToggle} aria-expanded={isOpen}
      className="mb-2 flex min-h-[32px] items-center gap-1.5 section-label hover:text-fg-2">
      <ChevronRight className={cx('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
      {label}
    </button>
  )

  const primary = basket.length > 0
    ? <Button variant="primary" onClick={handleSave} loading={busy} className="shrink-0 px-6">{dish ? 'Save meal' : `${verb} ${basket.length}`}</Button>
    : logged > 0
      ? <Button variant="primary" onClick={onClose} className="shrink-0 px-6">Done</Button>
      : <Button variant="primary" disabled className="shrink-0 px-6">{verb}</Button>

  // A one-off line: Quick add logs one with its macros; plan mode plans the typed name.
  const customEntry = plan
    ? (
      <button type="button" onClick={handlePlanTyped} disabled={write.isPending} className="row row-interactive min-h-[52px] px-1 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600"><PenLine className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <Truncate className="text-body font-medium text-accent-700">{`Plan “${quickParsed.title}” as typed`}</Truncate>
          <span className="block text-meta text-fg-muted tabular-nums">
            {quickParsed.kcal != null ? `A one-off line · ${quickParsed.kcal} kcal` : 'A one-off line — no ingredient saved'}
          </span>
        </span>
      </button>
    )
    : <QuickAddCustom query={query} busy={logFood.isPending} onLog={handleQuickAdd} />

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={plan ? `Plan ${slotWord}` : dish ? 'Edit meal' : 'Log food'}
      subtitle={dish ? `${dishShownName} · ${dateLabel}` : dateLabel}
      headerActions={<SlotSelect value={slot} onChange={setSlot} />}
      size="lg"
      mobile="fullscreen"
      panelClassName="sm:!h-[min(780px,88dvh)]"
      bodyClassName="flex flex-col gap-4 px-4 pb-4"
      footer={
        <div className="flex flex-col gap-2">
          {basket.length > 0 && (
            <div className="-mx-4 -mt-3 max-h-56 overflow-y-auto border-b border-line bg-surface-2 px-4 py-2 sm:-mx-5 sm:px-5">
              <div className="flex min-h-[32px] items-center justify-between gap-2">
                <p className="section-label shrink-0">This meal · {basket.length}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {!dish && !plan && basket.length > 1 && (
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-meta text-fg-muted"
                      title="Log these items as one compact line in the day view — tap it later to see each item's own details.">
                      <input type="checkbox" checked={asMeal} onChange={e => setAsMeal(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                      As meal
                    </label>
                  )}
                  <Button variant="ghost" size="sm" icon={<Save />} onClick={() => setSaveMealOpen(v => !v)} aria-expanded={saveMealOpen}>
                    Save as meal
                  </Button>
                </div>
              </div>
              {basket.map((it, i) => {
                const remove = () => setBasket(b => b.filter((_, j) => j !== i))
                if (isRecipeItem(it)) {
                  return <PortionBasketRow key={`r-${it.recipe.id}-${i}`} title={it.recipe.title} imageUrl={it.recipe.image_url}
                    amount={itemAmount(it)} kcal={itemMacros(it).kcal} onAmount={() => setPortion({ recipe: it.recipe, index: i })} onRemove={remove} />
                }
                if (isCustomItem(it)) {
                  return <PortionBasketRow key={`c-${it.entryId}`} title={it.title} kcal={it.macros.kcal} onRemove={remove} />
                }
                return <BasketRow key={`${it.ingredient.id}-${i}`} item={it} onGrams={raw => setGrams(i, raw)} onRemove={remove} />
              })}
              {saveMealOpen && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-line pb-1 pt-2">
                  <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="Meal name…" aria-label="Meal name"
                    className="input min-w-0 flex-1" />
                  <span className="shrink-0 text-meta text-fg-muted">makes</span>
                  <input value={mealServings} onChange={e => setMealServings(sanitizeDecimal(e.target.value))} inputMode="numeric"
                    aria-label="Portions this batch makes" title="How many portions this batch makes"
                    className="input w-12 px-1 text-center tabular-nums" />
                  <input value={mealPortionName} onChange={e => setMealPortionName(e.target.value)} maxLength={30}
                    placeholder="portion" aria-label="What one portion is called (piece, slice…)" title="What ONE portion is called — piece, slice, bowl"
                    className="input w-24 px-2" />
                  <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-meta text-fg-muted"
                    title="Add to your recipe Library. Off = a temp meal: reusable and editable, but hidden from the Library grid.">
                    <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                    Library
                  </label>
                  <Button size="sm" onClick={handleSaveMeal} loading={createRecipe.isPending} disabled={!mealName.trim()}>Save</Button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-ui font-bold text-fg tabular-nums">
                {Math.round(totals.kcal)} <span className="font-normal text-fg-muted">kcal</span>
                <span className="font-normal text-fg-faint"> · </span>
                {Math.round(totals.protein)} <span className="font-normal text-fg-muted">g protein</span>
                {basket.length > 0 && (
                  <span className="hidden font-normal text-fg-muted sm:inline"> · {Math.round(totals.carbs)} g carbs · {Math.round(totals.fat)} g fat</span>
                )}
              </p>
              {/* Planned rows count only once ticked as eaten: nothing is "left" by planning. */}
              {!plan && (targets.protein > 0 || targets.calories > 0) && (
                <Truncate as="p" className="text-meta text-fg-muted tabular-nums">
                  {/* Over the protein target is good news (success), over the calories a warning. */}
                  After: <span className={cx(protLeft < 0 && 'text-success')}>{protLeft >= 0 ? `${protLeft} g protein left` : `${-protLeft} g protein over`}</span>
                  {' · '}
                  <span className={cx(kcalLeft < 0 && 'text-danger')}>{kcalLeft >= 0 ? `${kcalLeft} kcal left` : `${-kcalLeft} kcal over`}</span>
                </Truncate>
              )}
            </div>
            {primary}
          </div>
        </div>
      }
    >
      <FoodSearchField query={query} onQuery={setQuery} library={library}
        onExisting={food => addToBasket(food)} onProduct={product => openNewFood({ name: product.name, product })} />

      {portion && (
        <RecipePortionSheet
          key={`${portion.recipe.id}-${portion.index ?? 'new'}`}
          recipe={portion.recipe}
          initial={portion.index != null ? (basket[portion.index] as { servings?: number } | undefined)?.servings : undefined}
          last={portion.last}
          busy={write.isPending}
          onClose={() => setPortion(null)}
          onLog={portion.index != null || dish || plan ? undefined : s => logPortion(portion.recipe, s)}
          onAdd={s => putPortion(portion.recipe, s, portion.index)}
          addLabel={portion.index != null ? 'Save amount' : plan ? 'Add to plan' : 'Add to meal'}
        />
      )}

      {newFood && (
        <NewFoodForm key={newFoodKey} seed={newFood} onCancel={() => setNewFood(null)}
          onCreated={created => { addToBasket(created); setNewFood(null) }} />
      )}

      {q ? (
        <div className="flex flex-col">
          {quickFirst && !exactLibraryHit && customEntry}
          {savedMeals.map(r => {
            const note = batchNote(batches.get(r.id), portionWord(r.serving_label))
            return (
              <button key={r.id} type="button" onClick={() => openPortion(r)} className="row row-interactive min-h-[56px] px-1 text-left">
                <span className={cx('flex min-w-0 flex-1 items-center gap-3', note?.gone && 'opacity-60')}>
                  <FoodThumb name={r.title} imageUrl={r.image_url} size={40} />
                  <span className="min-w-0 flex-1">
                    <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                    <Truncate className="text-meta text-fg-muted tabular-nums">
                      {['Saved meal', r.calories != null && `${Math.round(r.calories)} kcal / ${portionWord(r.serving_label)}`, note?.text].filter(Boolean).join(' · ')}
                    </Truncate>
                  </span>
                </span>
                <span className="shrink-0 text-meta font-semibold text-accent-600">Portion</span>
              </button>
            )
          })}
          {pastMatches.map(r => (
            <button key={r.key} type="button" onClick={() => addRecent(r)} className="row row-interactive min-h-[56px] px-1 text-left">
              <FoodThumb name={r.title} size={40} />
              <span className="min-w-0 flex-1">
                <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                <span className="block text-meta text-fg-muted">
                  Logged before{r.calories != null && ` · ${Math.round(r.calories)} kcal`}{r.protein_g != null && ` · ${Math.round(r.protein_g)} g protein`}
                </span>
              </span>
              <span className="shrink-0 text-meta font-semibold text-accent-600">{plan ? 'Plan' : 'Log again'}</span>
            </button>
          ))}
          {matches.map(ing => (
            <FoodMatchRow key={ing.id} food={ing} onAdd={() => addToBasket(ing, quickParsed.grams ?? undefined)} />
          ))}
          {!quickFirst && !exactLibraryHit && customEntry}
          <button type="button" onClick={() => openNewFood({ name: quickParsed.title })} className="row row-interactive min-h-[52px] px-1 text-left">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-dashed border-accent-500/50 text-accent-600"><Plus className="h-4 w-4" aria-hidden /></span>
            <span className="text-body text-accent-700">Save “{quickParsed.title}” as an ingredient (per 100g)…</span>
          </button>
        </div>
      ) : (
        <>
          {/* Favourites first — a pinned shortcut list, so it always leads. */}
          {favoriteTiles.length > 0 && (
            <section>
              {sectionToggle(favoritesOpen, () => setFavoritesOpen(v => !v), <><Star className="h-3.5 w-3.5" aria-hidden /> Favourites ({favoriteTiles.length})</>)}
              {favoritesOpen && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {favoriteTiles.map(({ r, lib }) => (
                    <FoodTile key={r.key} title={r.title} group={lib?.food_group} imageUrl={lib?.image_url}
                      calories={r.calories} sizeClass="w-9 h-9 sm:w-11 sm:h-11"
                      isFavorite onAdd={() => addRecent(r)}
                      onToggleFavorite={() => removeFavorite.mutate(r.key)} />
                  ))}
                </div>
              )}
            </section>
          )}

          {recentTiles.length > 0 && (
            <section>
              {sectionToggle(recentOpen, () => setRecentOpen(v => !v), 'Recent')}
              {recentOpen && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {recentTiles.map(({ r, lib }) => (
                    <FoodTile key={r.key} title={r.title} group={lib?.food_group} imageUrl={lib?.image_url}
                      calories={r.calories} sizeClass="w-9 h-9 sm:w-11 sm:h-11"
                      isFavorite={favoriteKeys.has(r.key)} onAdd={() => addRecent(r)}
                      onToggleFavorite={() => favoriteKeys.has(r.key) ? removeFavorite.mutate(r.key) : addFavorite.mutate(r)}
                      onHide={() => hideRecent.mutate(r.key)} />
                  ))}
                </div>
              )}
            </section>
          )}

          {savedMeals.length > 0 && (
            <section>
              <p className="section-label mb-2">Saved meals</p>
              {/* Full-bleed to the sheet edges, snapping at the body's 16px inset. */}
              <div className="scroll-x -mx-4 flex snap-x scroll-px-4 gap-2 px-4 pb-1">
                {savedMeals.map(r => {
                  // Hover (desktop) / the ✎ editor (mobile) reveals the meal's
                  // ingredients — a temp meal is one named unit, not N loose rows.
                  const contents = r.ingredients?.map(i => i.name).filter(Boolean).join(', ') || undefined
                  // What is left of its batch, on the tile (8.3): "13 pieces left";
                  // a batch eaten up or over is greyed ("none left") — still tappable.
                  const word = portionWord(r.serving_label)
                  const note = batchNote(batches.get(r.id), word)
                  const line = note
                    ? [note.text, r.calories != null && `${Math.round(r.calories)} kcal`].filter(Boolean).join(' · ')
                    : [r.calories != null && `${Math.round(r.calories)} kcal`, r.servings > 1 && countLabel(r.servings, word)].filter(Boolean).join(' · ')
                  return (
                    <div key={r.id} className="relative w-40 shrink-0 snap-start">
                      <button type="button" onClick={() => openPortion(r)} title={contents}
                        className={cx(
                          'flex h-full w-full flex-col items-start gap-1 rounded-card border p-2.5 text-left transition-colors',
                          portion?.recipe.id === r.id ? 'border-accent-500 bg-accent-50' : 'border-line bg-surface-2 hover:border-line-strong',
                          note?.gone && 'opacity-60',
                        )}>
                        <FoodThumb name={r.title} imageUrl={r.image_url} size={36} />
                        <Truncate lines={2} className="pr-5 text-meta font-medium leading-tight text-fg">{r.title}</Truncate>
                        <Truncate className={cx('w-full text-micro normal-case tracking-normal tabular-nums', note && !note.gone ? 'font-semibold text-fg-2' : 'text-fg-muted')}>
                          {line}
                        </Truncate>
                      </button>
                      {/* A deliberate 24px secondary action on a dense strip (see FoodTile). */}
                      <button type="button" aria-label={`Edit ${r.title}`}
                        // Keep a half-built basket: the editor opens on top instead.
                        onClick={() => { onEditRecipe(r); if (basket.length === 0 && !dish) onClose() }}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-fg-muted hover:text-accent-600"><Pencil aria-hidden className="h-3 w-3" /></button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {favoriteTiles.length === 0 && recentTiles.length === 0 && savedMeals.length === 0 && (
            <div className="grid flex-1 place-items-center py-10 text-center">
              <div>
                <p className="mb-2 text-3xl">🍽️</p>
                <p className="text-body text-fg-muted">Search a food above, scan a barcode,</p>
                <p className="text-body text-fg-muted">or create your first ingredient.</p>
              </div>
            </div>
          )}
        </>
      )}
    </ModalShell>
  )
}
