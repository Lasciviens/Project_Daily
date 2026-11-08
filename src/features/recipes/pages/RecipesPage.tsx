import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, UtensilsCrossed } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import { Button, PageContainer, PageHeader, SegmentedControl, SkeletonTab, SteadySlot, type SegmentedOption } from '../../../shared/ui'
import { FoodTodayTab } from '../components/FoodTodayTab'
import { FoodDateNav } from '../components/FoodDateNav'
import { FoodHeroArt } from '../components/FoodHeroArt'
import { useDoseLink } from '../../supplements/hooks/useDoseLink'
import { useFollowToday } from '../../../shared/hooks/useToday'

// Today is in the page's own code; the other tabs load when opened, and in idle time once the page shows.
const LibraryTab = lazyPart('food-library', () => import('../components/LibraryTab').then(m => m.LibraryTab))
const IngredientManager = lazyPart<{ focusId?: string | null }>('food-ingredients', () => import('../components/IngredientManager').then(m => m.IngredientManager))
const MealPlanWeek = lazyPart('food-plan', () => import('../components/MealPlanWeek').then(m => m.MealPlanWeek))
const FoodInsightsTab = lazyPart('food-insights', () => import('../components/FoodInsightsTab').then(m => m.FoodInsightsTab))
const OTHER_TABS = [LibraryTab, IngredientManager, MealPlanWeek, FoodInsightsTab]

type Tab = 'today' | 'library' | 'ingredients' | 'plan' | 'insights'

const TABS: SegmentedOption<Tab>[] = [
  { value: 'today', label: 'Today' },
  { value: 'library', label: 'Library' },
  // Five tabs fit a 393 px phone only with the short names.
  { value: 'ingredients', label: <><span className="sm:hidden">Foods</span><span className="hidden sm:inline">Ingredients</span></> },
  { value: 'plan', label: <><span className="sm:hidden">Plan</span><span className="hidden sm:inline">Meal plan</span></> },
  { value: 'insights', label: 'Insights' },
]


export function RecipesPage() {
  const modal = useEntityModal()
  // `?food=<id>` (Edit entry's "Edit food") opens Ingredients with that food in the form.
  const [params] = useSearchParams()
  const focusFood = params.get('food')
  const [tab,      setTab]      = useState<Tab>(() => (focusFood ? 'ingredients' : 'today'))
  const [seenFood, setSeenFood] = useState(focusFood)
  if (focusFood !== seenFood) { setSeenFood(focusFood); if (focusFood) setTab('ingredients') }
  // The Today tab's day — `?date=` from Personal's food popup ("Open the Food page"), else today.
  const [foodDate, setFoodDate] = useState(() => {
    const asked = params.get('date')
    return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : formatLocalDate(new Date())
  })
  // A supplement reminder's tap shows its day on Today, whichever tab was open.
  useDoseLink(date => { setTab('today'); setFoodDate(date) })
  useFollowToday(foodDate, setFoodDate)
  useIdlePreload(OTHER_TABS)

  const addRecipe = () => modal.open({ kind: 'recipe' })
  // Logs into the VIEWED day, never a hardcoded today.
  const logFood = () => modal.open({ kind: 'food-log', date: foodDate })
  const logButton = <Button variant="primary" icon={<UtensilsCrossed />} onClick={logFood}>Log food</Button>

  // Two rows on a phone: the tabs, then the day picker with the actions on
  // its right (owner, 06.10.2026 — fewer rows before the first meal). They
  // share one row once both fit: the second group sizes on its content
  // (`flex-auto`), so it wraps under the tabs instead of running out of the
  // card. Shop is its own page now (no Food | Shop switch).
  // The second group is the same on every tab (owner, 03.11.2026: a tab switch
  // never reshapes the bar): each tab's version — Today: the day + Log food,
  // Library: Add recipe + Log food, the rest: Log food — sits in one slot as
  // wide as the widest, so whether it wraps depends on the width only and a
  // phone keeps its second row on every tab.
  return (
    <PageContainer>
      <PageHeader title="Food" art={<FoodHeroArt />}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="w-full sm:w-auto [&_.seg-btn]:px-1.5 [&_.seg]:w-full sm:[&_.seg-btn]:px-3 sm:[&_.seg]:w-auto">
            <SegmentedControl options={TABS} value={tab} onChange={setTab} />
          </div>
          <SteadySlot className="min-w-0 flex-auto" show={tab === 'today' || tab === 'library' ? tab : 'other'} items={{
            today: (
              <div className="flex items-center gap-2">
                <FoodDateNav value={foodDate} onChange={setFoodDate} />
                <div className="ml-auto shrink-0">{logButton}</div>
              </div>
            ),
            library: (
              <div className="flex items-center justify-end gap-2">
                {/* Never a bare "+" beside Log food on a phone: it says what it adds. */}
                <Button icon={<Plus />} onClick={addRecipe} aria-label="Add recipe" title="Add recipe"><span className="sm:hidden">Recipe</span><span className="max-sm:hidden">Add recipe</span></Button>
                {logButton}
              </div>
            ),
            other: <div className="flex justify-end">{logButton}</div>,
          }} />
        </div>
      </PageHeader>

      <Suspense fallback={<SkeletonTab />}>
        {tab === 'today' && <FoodTodayTab date={foodDate} />}
        {tab === 'ingredients' && <IngredientManager focusId={focusFood} />}
        {tab === 'plan' && <MealPlanWeek />}
        {tab === 'insights' && <FoodInsightsTab />}

        {tab === 'library' && <LibraryTab />}
      </Suspense>
    </PageContainer>
  )
}
