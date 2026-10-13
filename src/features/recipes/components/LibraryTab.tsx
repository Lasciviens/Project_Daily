import { useMemo, useState } from 'react'
import { ChefHat, Plus } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries } from '../hooks/useFoodLog'
import { USAGE_DAYS, useFoodUsage } from '../hooks/useFoodUsage'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { ingredientSnapshot, recipeSnapshot } from '../api/foodLogApi'
import {
  dayRemaining, filterRecipes, searchFoods, sortRecipes, usageKey,
  type FoodHit, type RecipeFlag, type RecipeSort,
} from '../foodLibraryModel'
import { amountUnit } from '../foodBasket'
import { RecipeCard } from './RecipeCard'
import { LibraryFoodCard } from './LibraryFoodCard'
import { LibraryTabFilters } from './LibraryTabFilters'
import { SLOT_OPTIONS, slotForNow } from './foodLogUtils'
import type { FoodCategory, MealSlot } from '../types'

// One column on a phone; from there as many 20rem+ columns as the width holds
// (a card keeps its numbers on one line from 20rem).
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3'

/** A supplement goes to the supplement slot; anything else to the meal the clock is in. */
const logSlotFor = (supplement: boolean): MealSlot => (supplement ? 'supplement' : slotForNow())
const slotLabel = (s: MealSlot) => SLOT_OPTIONS.find(o => o.id === s)?.label.toLowerCase() ?? s

export function LibraryTab() {
  const { data: recipes = [], isLoading } = useRecipes()
  const { data: foods = [] } = useIngredientLibrary()
  const { usage } = useFoodUsage()
  const today = todayStr()
  const { targets, isLoaded } = useDayTargets()
  const { data: eaten } = useDayNutrition(today)
  const modal = useEntityModal()
  const logFood = useAddFoodLogEntries()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FoodCategory | 'all'>('all')
  const [flags, setFlags] = useState<RecipeFlag[]>([])
  const [sort, setSort] = useState<RecipeSort>('recent')

  // What today still has room for — "Fits today" compares one serving with it.
  const kcalLeft = isLoaded && eaten ? dayRemaining(targets, eaten).kcal : null
  const libraryCount = useMemo(() => recipes.filter(r => !r.is_temp).length, [recipes])
  const savedCount = recipes.length - libraryCount
  const shown = useMemo(
    () => sortRecipes(filterRecipes(recipes, { query, category, flags, kcalLeft }), sort, usage),
    [recipes, query, category, flags, kcalLeft, sort, usage],
  )
  const foodHits = useMemo(() => searchFoods(foods, { query, category, flags, kcalLeft }), [foods, query, category, flags, kcalLeft])
  const toggle = (f: RecipeFlag) => setFlags(fs => (fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f]))
  const narrowed = query.trim() !== '' || category !== 'all' || flags.some(f => f !== 'saved')
  const clearFilters = () => { setQuery(''); setCategory('all'); setFlags(fs => fs.filter(f => f === 'saved')) }
  const addRecipe = () => modal.open({ kind: 'recipe' })

  function logRecipe(id: string) {
    const r = recipes.find(x => x.id === id)
    if (!r) return
    logFood.mutate([{
      date: today, meal_slot: logSlotFor(r.category === 'supplement'),
      recipe_id: r.id, quantity: 1, unit: 'serving', ...recipeSnapshot(r, 1),
    }])
  }
  function logPortion({ food, grams }: FoodHit) {
    logFood.mutate([{
      date: today, meal_slot: logSlotFor(food.food_group === 'Supplements'),
      library_ingredient_id: food.id, quantity: grams, unit: amountUnit(food.unit), ...ingredientSnapshot(food, grams),
    }])
  }

  if (isLoading) {
    return <div className={GRID}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
  }
  if (recipes.length === 0 && !query) {
    return (
      <EmptyState bordered icon={<ChefHat />} title="No recipes yet"
        description="Search your foods, tap to add, type the grams — the macros add up as you go."
        action={<Button icon={<Plus />} onClick={addRecipe}>Add recipe</Button>} />
    )
  }

  const summary = flags.includes('saved')
    ? 'Saved meals from the logger. They stay out of the Library until you tick “Show in Library” in their editor.'
    : [
        shown.length === libraryCount ? `${libraryCount} recipes` : `${shown.length} of ${libraryCount} recipes`,
        foodHits.length > 0 && `${foodHits.length} ${foodHits.length === 1 ? 'food' : 'foods'}`,
        'per serving',
        `eaten counts: last ${USAGE_DAYS} days`,
      ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-3">
      <LibraryTabFilters query={query} onQuery={setQuery} sort={sort} onSort={setSort} flags={flags} onToggleFlag={toggle}
        category={category} onCategory={setCategory} kcalLeft={kcalLeft} savedCount={savedCount} />
      <p className="text-meta text-fg-muted">{summary}</p>

      {shown.length === 0 && foodHits.length === 0 ? (
        <EmptyState title={flags.includes('fits') && kcalLeft != null && kcalLeft <= 0 ? 'Nothing fits — today’s calories are used' : 'Nothing matches'}
          description={narrowed ? 'Try fewer filters, or make it a recipe.' : flags.includes('saved') ? 'No saved meals.' : 'Nothing here yet.'}
          action={narrowed ? <Button onClick={clearFilters}>Clear filters</Button> : undefined} />
      ) : (
        <>
          {shown.length > 0 && (
            <div className={`${GRID} stagger-in`}>
              {shown.map(r => (
                <RecipeCard key={r.id} recipe={r} usage={usage.get(usageKey.recipe(r.id))}
                  onOpen={() => modal.open({ kind: 'recipe-view', id: r.id })}
                  onLog={() => logRecipe(r.id)}
                  logLabel={`Log 1 serving of ${r.title} to ${slotLabel(logSlotFor(r.category === 'supplement'))} today`} />
              ))}
            </div>
          )}
          {foodHits.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="section-label">Foods</h3>
              <div className={GRID}>
                {foodHits.map(h => (
                  <LibraryFoodCard key={h.food.id} hit={h} usage={usage.get(usageKey.ingredient(h.food.id))}
                    onOpen={() => modal.open({ kind: 'food-log', date: today, query: h.food.name })}
                    onLog={() => logPortion(h)}
                    logLabel={`Log ${h.portion} of ${h.food.name} to ${slotLabel(logSlotFor(h.food.food_group === 'Supplements'))} today`} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
