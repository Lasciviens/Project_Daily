import { useState } from 'react'
import { isToday } from 'date-fns'
import { Cell, CellHeader } from './cellKit'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { FoodLogModal } from '../../../recipes/components/FoodLogModal'
import type { MealSlot } from '../../../recipes/types'
import type { DayMeal } from '../../api/dayNutritionApi'

// The day's meals as a compact timeline. The slot matching the current time of
// day is highlighted (accent ring), the rest stay visible — "what's next to
// eat" at a glance, with a per-slot tap to log straight into that slot.
const SLOTS: { slot: MealSlot; label: string; icon: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast',  icon: '🌅' },
  { slot: 'lunch',      label: 'Lunch',      icon: '☀️' },
  { slot: 'dinner',     label: 'Dinner',     icon: '🌙' },
  { slot: 'snack',      label: 'Snack',      icon: '🍎' },
  { slot: 'supplement', label: 'Supplement', icon: '💊' },
]

function currentSlot(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

export function MealsCard({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const [logSlot, setLogSlot] = useState<MealSlot | null>(null)
  // Only "highlight now" on today — a past/future day has no live current meal.
  const now = isToday(new Date(date + 'T00:00:00')) ? currentSlot() : null

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []
    arr.push(m)
    bySlot.set(m.meal_slot, arr)
  }

  return (
    <Cell>
      <CellHeader icon="🍽️" title="Meals" />
      <ul className="flex flex-col gap-1">
        {SLOTS.map(({ slot, label, icon }) => {
          const meals = bySlot.get(slot) ?? []
          const kcal = meals.reduce((a, m) => a + m.calories, 0)
          const isNow = slot === now
          return (
            <li key={slot}>
              <button
                onClick={() => setLogSlot(slot)}
                className={`w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 min-h-[40px] transition-colors ${
                  isNow ? 'bg-accent-50 ring-1 ring-accent-300' : 'hover:bg-ink-100/50'
                }`}
              >
                <span className="text-sm leading-none w-5 text-center shrink-0">{icon}</span>
                <span className={`text-xs shrink-0 w-16 ${isNow ? 'font-semibold text-accent-700' : 'text-ink-600'}`}>
                  {label}{isNow && <span className="text-[9px] font-normal text-accent-500"> · now</span>}
                </span>
                {meals.length > 0 ? (
                  <span className="text-[11px] text-ink-500 flex-1 min-w-0 truncate">
                    {meals.map(m => m.title.split(' · ')[0]).join(', ')}
                  </span>
                ) : (
                  <span className="text-[11px] text-ink-300 flex-1">+ log</span>
                )}
                {kcal > 0 && <span className="text-[11px] text-ink-400 tabular-nums shrink-0">{kcal} kcal</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {logSlot && (
        <FoodLogModal open onClose={() => setLogSlot(null)} date={date} defaultSlot={logSlot} />
      )}
    </Cell>
  )
}
