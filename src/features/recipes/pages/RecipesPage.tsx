import { useState } from 'react'
import { Plus, UtensilsCrossed } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { Button, PageContainer, PageHeader, SegmentedControl, cx, type SegmentedOption } from '../../../shared/ui'
import { LibraryTab } from '../components/LibraryTab'
import { FoodInsightsTab } from '../components/FoodInsightsTab'
import { MealPlanWeek } from '../components/MealPlanWeek'
import { IngredientManager } from '../components/IngredientManager'
import { FoodTodayTab } from '../components/FoodTodayTab'
import { FoodDateNav } from '../components/FoodDateNav'

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
  const [tab,      setTab]      = useState<Tab>('today')
  const [foodDate, setFoodDate] = useState(() => formatLocalDate(new Date()))   // the Today tab's day

  const phoneRowless = tab !== 'today' && tab !== 'library'
  const addRecipe = () => modal.open({ kind: 'recipe' })
  // Logs into the VIEWED day, never a hardcoded today.
  const logFood = () => modal.open({ kind: 'food-log', date: foodDate })

  // Two rows on a phone: the tabs, then the day picker with the actions on
  // its right (owner, 06.10.2026 — fewer rows before the first meal). From
  // `sm` they share one row. Shop is its own page now (no Food | Shop switch).
  return (
    <PageContainer>
      <PageHeader title="Food">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="w-full sm:w-auto [&_.seg-btn]:px-1.5 [&_.seg]:w-full sm:[&_.seg-btn]:px-3 sm:[&_.seg]:w-auto">
            <SegmentedControl options={TABS} value={tab} onChange={setTab} />
          </div>
          {/* On a phone the second row only exists where it does something on
              that tab (Today: the day + Log food; Library: Add recipe + Log food). */}
          <div className={cx('flex min-w-0 flex-1 items-center gap-2', phoneRowless && 'max-sm:hidden')}>
            {tab === 'today' && <FoodDateNav value={foodDate} onChange={setFoodDate} />}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {tab === 'library' && <Button icon={<Plus />} onClick={addRecipe} aria-label="Add recipe" title="Add recipe"><span className="max-sm:hidden">Add recipe</span></Button>}
              <Button variant="primary" icon={<UtensilsCrossed />} onClick={logFood}>Log food</Button>
            </div>
          </div>
        </div>
      </PageHeader>

      {tab === 'today' && <FoodTodayTab date={foodDate} />}
      {tab === 'ingredients' && <IngredientManager />}
      {tab === 'plan' && <MealPlanWeek />}
      {tab === 'insights' && <FoodInsightsTab />}

      {tab === 'library' && <LibraryTab />}
    </PageContainer>
  )
}
