import { useMemo, useState } from 'react'
import { ChefHat, Plus, Search } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useRecipes } from '../hooks/useRecipes'
import { useAddFoodLogEntries } from '../hooks/useFoodLog'
import { USAGE_DAYS, useFoodUsage } from '../hooks/useFoodUsage'
import { recipeSnapshot } from '../api/foodLogApi'
import {
  RECIPE_FLAGS, RECIPE_SORTS, filterRecipes, sortRecipes, usageKey, type RecipeFlag, type RecipeSort,
} from '../foodLibraryModel'
import { RecipeCard } from './RecipeCard'
import { SLOT_OPTIONS, slotForNow } from './foodLogUtils'
import type { FoodCategory, MealSlot, RecipeWithIngredients } from '../types'

const CATEGORIES: (FoodCategory | 'all')[] = ['all', 'breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const GRID = 'grid grid-cols-2 justify-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,15rem))]'

/** A supplement goes to the supplement slot; anything else to the meal the clock is in. */
const logSlotFor = (r: RecipeWithIngredients): MealSlot => (r.category === 'supplement' ? 'supplement' : slotForNow())
const slotLabel = (s: MealSlot) => SLOT_OPTIONS.find(o => o.id === s)?.label.toLowerCase() ?? s

export function LibraryTab() {
  const { data: recipes = [], isLoading } = useRecipes()
  const { usage } = useFoodUsage()
  const modal = useEntityModal()
  const logFood = useAddFoodLogEntries()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FoodCategory | 'all'>('all')
  const [flags, setFlags] = useState<RecipeFlag[]>([])
  const [sort, setSort] = useState<RecipeSort>('recent')

  const libraryCount = useMemo(() => recipes.filter(r => !r.is_temp).length, [recipes])
  const savedCount = recipes.length - libraryCount
  const shown = useMemo(
    () => sortRecipes(filterRecipes(recipes, { query, category, flags }), sort, usage),
    [recipes, query, category, flags, sort, usage],
  )
  const toggle = (f: RecipeFlag) => setFlags(fs => (fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f]))
  const narrowed = query.trim() !== '' || category !== 'all' || flags.some(f => f !== 'saved')
  const addRecipe = () => modal.open({ kind: 'recipe' })

  function quickLog(r: RecipeWithIngredients) {
    logFood.mutate([{
      date: todayStr(), meal_slot: logSlotFor(r),
      recipe_id: r.id, quantity: 1, unit: 'serving',
      ...recipeSnapshot(r, 1),
    }])
  }

  if (isLoading) {
    return <div className={GRID}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-card" />)}</div>
  }
  if (recipes.length === 0) {
    return (
      <EmptyState bordered icon={<ChefHat />} title="No recipes yet"
        description="Add your first recipe to start planning meals."
        action={<Button icon={<Plus />} onClick={addRecipe}>Add recipe</Button>} />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-full max-w-md">
            <span className="sr-only">Search recipes</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes or ingredients"
              className="input pl-9" />
          </label>
          <label className="flex items-center gap-2 text-meta text-fg-muted">
            Sort
            <select className="input w-auto" value={sort} onChange={e => setSort(e.target.value as RecipeSort)}>
              {RECIPE_SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div role="tablist" aria-label="Category" className="scroll-x -mx-1 flex gap-1.5 px-1">
          {CATEGORIES.map(c => (
            <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
              className="pill-tab shrink-0 capitalize">
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
        <div className="scroll-x -mx-1 flex gap-1.5 px-1" aria-label="Show only">
          {RECIPE_FLAGS.map(f => {
            if (f.value === 'saved' && savedCount === 0) return null
            const label = f.value === 'saved' ? `${f.label} (${savedCount})` : f.label
            return (
              <button key={f.value} type="button" aria-pressed={flags.includes(f.value)} onClick={() => toggle(f.value)}
                title={f.hint} className="pill-tab min-h-[44px] shrink-0 sm:min-h-0">
                {label}
              </button>
            )
          })}
        </div>
        <p className="text-meta text-fg-muted">
          {flags.includes('saved')
            ? <>Saved meals from the logger. They stay out of the Library until you tick "Show in Library" in their editor.</>
            : <>{shown.length === libraryCount ? `${libraryCount} recipes` : `${shown.length} of ${libraryCount} recipes`} · macros per serving · eaten counts from the last {USAGE_DAYS} days</>}
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No recipes match"
          description={narrowed ? 'Nothing matches these filters.' : flags.includes('saved') ? 'No saved meals.' : 'Nothing here yet.'}
          action={narrowed ? <Button onClick={() => { setQuery(''); setCategory('all'); setFlags(fs => fs.filter(f => f === 'saved')) }}>Clear filters</Button> : undefined} />
      ) : (
        <div className={`${GRID} stagger-in`}>
          {shown.map(r => (
            <RecipeCard key={r.id} recipe={r} usage={usage.get(usageKey.recipe(r.id))} usageDays={USAGE_DAYS}
              onOpen={() => modal.open({ kind: 'recipe-view', id: r.id })}
              onLog={() => quickLog(r)}
              logLabel={`Log 1 serving to ${slotLabel(logSlotFor(r))} today`} />
          ))}
        </div>
      )}
    </div>
  )
}
