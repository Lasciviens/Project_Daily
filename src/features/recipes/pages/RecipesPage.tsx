import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { ChefHat, Plus, Search, UtensilsCrossed } from 'lucide-react'
import { useRecipes } from '../hooks/useRecipes'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { DateNav } from '../../../shared/components/DateNav'
import { formatLocalDate, shiftDateStr } from '../../../shared/utils/dateUtils'
import { Button, EmptyState, PageContainer, PageHeader, SegmentedControl, Skeleton, type SegmentedOption } from '../../../shared/ui'
import { RecipeCard } from '../components/RecipeCard'
import { MealPlanWeek } from '../components/MealPlanWeek'
import { IngredientManager } from '../components/IngredientManager'
import { FoodTodayTab } from '../components/FoodTodayTab'
import type { FoodCategory } from '../types'
import { FoodTabs } from '../../personal/components/PersonalLayout'

type Tab = 'today' | 'library' | 'ingredients' | 'plan'

const TABS: SegmentedOption<Tab>[] = [
  { value: 'today', label: 'Today' },
  { value: 'library', label: 'Library' },
  { value: 'ingredients', label: 'Ingredients' },
  { value: 'plan', label: 'Meal plan' },
]

const CATEGORIES: (FoodCategory | 'all')[] = ['all', 'breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const LIBRARY_GRID = 'grid grid-cols-2 justify-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,13rem))]'

export function RecipesPage() {
  const { data: recipes = [], isLoading } = useRecipes()
  const modal = useEntityModal()
  const [tab,      setTab]      = useState<Tab>('today')
  const [query,    setQuery]    = useState('')
  const [category, setCategory] = useState<FoodCategory | 'all'>('all')
  const [foodDate, setFoodDate] = useState(() => formatLocalDate(new Date()))   // the Today tab's day
  const today = formatLocalDate(new Date())
  const foodIsToday = foodDate === today

  const libraryRecipes = useMemo(() => recipes.filter(r => !r.is_temp), [recipes])
  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Temp meals (saved from the logger) stay out of the Library grid; they
    // live in the logger's "Saved meals" strip.
    let out = libraryRecipes
    if (category !== 'all') out = out.filter(r => r.category === category)
    if (!q) return out
    return out.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      r.ingredients.some(i => i.name.toLowerCase().includes(q))
    )
  }, [libraryRecipes, query, category])

  const addRecipe = () => modal.open({ kind: 'recipe' })
  // Logs into the VIEWED day, never a hardcoded today.
  const logFood = () => modal.open({ kind: 'food-log', date: foodDate })

  return (
    <PageContainer>
      <PageHeader
        title="Food"
        subtitle="Log meals, plan the week and keep your recipes and foods"
        className="max-md:[&_h1]:sr-only max-md:[&_h1+p]:hidden"
        actions={<>
          <FoodTabs />
          {tab === 'library' && <Button icon={<Plus />} onClick={addRecipe}>Add recipe</Button>}
          <Button variant="primary" icon={<UtensilsCrossed />} onClick={logFood}>Log food</Button>
        </>}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="w-full sm:w-auto [&_.seg-btn]:px-1.5 [&_.seg]:w-full sm:[&_.seg-btn]:px-3 sm:[&_.seg]:w-auto">
            <SegmentedControl options={TABS} value={tab} onChange={setTab} />
          </div>
          {tab === 'today' && (
            <DateNav
              size="md"
              label={foodIsToday ? 'Today' : format(new Date(foodDate + 'T00:00:00'), 'EEE d MMM')}
              labelClassName="min-w-[104px] text-center text-ui font-semibold text-fg"
              onPrev={() => setFoodDate(s => shiftDateStr(s, -1))}
              onNext={() => setFoodDate(s => shiftDateStr(s, 1))}
              onToday={() => setFoodDate(today)}
              isToday={foodIsToday}
              pickerValue={foodDate}
              onPick={setFoodDate}
            />
          )}
        </div>
      </PageHeader>

      {tab === 'today' && <FoodTodayTab date={foodDate} />}
      {tab === 'ingredients' && <IngredientManager />}
      {tab === 'plan' && <MealPlanWeek />}

      {tab === 'library' && (
        <div className="flex flex-col gap-4">
          {libraryRecipes.length > 0 && (
            <div className="flex flex-col gap-3">
              <label className="relative block w-full max-w-md">
                <span className="sr-only">Search recipes</span>
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes or ingredients"
                  className="input pl-9" />
              </label>
              <div role="tablist" aria-label="Category" className="scroll-x -mx-1 flex gap-1.5 px-1">
                {CATEGORIES.map(c => (
                  <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
                    className="pill-tab shrink-0 capitalize">
                    {c === 'all' ? 'All' : c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className={LIBRARY_GRID}>
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-card" />)}
            </div>
          ) : libraryRecipes.length === 0 ? (
            <EmptyState bordered icon={<ChefHat />} title="No recipes yet"
              description="Add your first recipe to start planning meals."
              action={<Button icon={<Plus />} onClick={addRecipe}>Add recipe</Button>} />
          ) : filteredRecipes.length === 0 ? (
            <EmptyState title="No recipes match" description={query ? `Nothing matches "${query}".` : 'Nothing in this category yet.'} />
          ) : (
            <div className={`${LIBRARY_GRID} stagger-in`}>
              {filteredRecipes.map(r => (
                <RecipeCard key={r.id} recipe={r} onClick={() => modal.open({ kind: 'recipe-view', id: r.id })} />
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
