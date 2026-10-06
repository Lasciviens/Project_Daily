import { useState } from 'react'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { Plus, UtensilsCrossed } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { DateNav } from '../../../shared/components/DateNav'
import { formatLocalDate, shiftDateStr } from '../../../shared/utils/dateUtils'
import { Button, PageContainer, PageHeader, SegmentedControl, type SegmentedOption } from '../../../shared/ui'
import { LibraryTab } from '../components/LibraryTab'
import { FoodInsightsTab } from '../components/FoodInsightsTab'
import { MealPlanWeek } from '../components/MealPlanWeek'
import { IngredientManager } from '../components/IngredientManager'
import { FoodTodayTab } from '../components/FoodTodayTab'
import { FoodTabs } from '../../personal/components/PersonalLayout'

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
  const today = formatLocalDate(new Date())
  const foodIsToday = foodDate === today

  const addRecipe = () => modal.open({ kind: 'recipe' })
  // Logs into the VIEWED day, never a hardcoded today.
  const logFood = () => modal.open({ kind: 'food-log', date: foodDate })

  return (
    <PageContainer>
      <PageHeader
        title="Food"
        actions={<>
          <FoodTabs />
          {/* Icon-only on a phone so Food|Shop, Add and Log food keep one row. */}
          {tab === 'library' && <Button icon={<Plus />} onClick={addRecipe} aria-label="Add recipe" title="Add recipe"><span className="max-sm:hidden">Add recipe</span></Button>}
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
              label={foodIsToday ? 'Today' : formatWeekdayDate(foodDate)}
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
      {tab === 'insights' && <FoodInsightsTab />}

      {tab === 'library' && <LibraryTab />}
    </PageContainer>
  )
}
