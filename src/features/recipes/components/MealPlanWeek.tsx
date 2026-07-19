import { useState, Fragment } from 'react'
import { format, addDays, addWeeks, startOfWeek, endOfWeek, isToday, getISOWeek } from 'date-fns'
import { useMealPlan } from '../hooks/useMealPlan'
import { useFoodLogRange } from '../hooks/useFoodLog'
import { AssignMealModal } from './AssignMealModal'
import { EditFoodLogModal } from './EditFoodLogModal'
import { DateNav } from '../../../shared/components/DateNav'
import type { MealSlot, MealPlanEntry } from '../types'
import type { LoggedFood } from '../api/foodLogApi'
import type { DayMeal } from '../../daily/api/dayNutritionApi'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', supplement: 'Suppl.' }

interface CellTarget { date: string; slot: MealSlot; entry: MealPlanEntry | null }

// A logged (diary) row → the DayMeal shape EditFoodLogModal edits.
function loggedToDayMeal(l: LoggedFood): DayMeal {
  return {
    id: l.id, meal_slot: l.meal_slot, title: l.title, servings: 1,
    calories: Math.round(l.calories ?? 0), protein_g: Math.round(l.protein_g ?? 0),
    carbs_g: Math.round(l.carbs_g ?? 0), fat_g: Math.round(l.fat_g ?? 0),
    fiber_g: Math.round(l.fiber_g ?? 0), sugar_g: Math.round(l.sugar_g ?? 0),
    source: 'log',
    logEntry: { library_ingredient_id: l.library_ingredient_id, recipe_id: l.recipe_id, custom_title: l.custom_title, quantity: l.quantity, unit: l.unit },
  }
}

export function MealPlanWeek() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [target, setTarget] = useState<CellTarget | null>(null)
  const [editLog, setEditLog] = useState<LoggedFood | null>(null)

  const baseStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekStart = weekOffset === 0 ? baseStart : addWeeks(baseStart, weekOffset)
  const weekEnd   = endOfWeek(weekStart, { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const fromStr = format(weekStart, 'yyyy-MM-dd')
  const toStr   = format(weekEnd, 'yyyy-MM-dd')

  const { data: entries = [] } = useMealPlan(fromStr, toStr)     // the PLAN
  const { data: logged = [] }  = useFoodLogRange(fromStr, toStr) // the DIARY (eaten)

  function entryFor(dateStr: string, slot: MealSlot): MealPlanEntry | null {
    return entries.find(e => e.date === dateStr && e.meal_slot === slot) ?? null
  }
  const eatenBy = new Map<string, LoggedFood[]>()
  for (const l of logged) {
    const k = `${l.date}|${l.meal_slot}`
    const arr = eatenBy.get(k) ?? []
    arr.push(l); eatenBy.set(k, arr)
  }

  return (
    <div>
      {/* Week nav — app-standard ‹ label › date navigation (shared DateNav) */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <DateNav
          label={`Week ${getISOWeek(weekStart)}`}
          labelClassName="text-sm font-bold text-ink-900 min-w-[72px]"
          onPrev={() => setWeekOffset(w => w - 1)}
          onNext={() => setWeekOffset(w => w + 1)}
          onToday={() => setWeekOffset(0)}
          isToday={weekOffset === 0}
        />
        <span className="text-xs text-ink-400">{format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}</span>
      </div>
      {/* Legend — the plan vs what was actually eaten (the Today diary), now
          shown together so a logged day no longer looks empty here. */}
      <p className="text-[11px] text-ink-400 mb-3">📋 planned · <span className="text-green-600">✓ eaten</span> (from Today) — tap to edit</p>

      {/* Grid — meal slots as rows, days as columns (min-w-[720px] → scrolls
          on narrow screens; scroll-fade-x hints it). */}
      <div className="overflow-x-auto scrollbar-none scroll-fade-x">
        <div className="grid gap-1.5 min-w-[720px]" style={{ gridTemplateColumns: '80px repeat(7, 1fr)' }}>
          {/* Header row */}
          <div />
          {days.map(day => (
            <div key={day.toISOString()} className={`text-center py-1.5 rounded-lg ${isToday(day) ? 'bg-accent-50' : ''}`}>
              <p className="text-[9px] font-semibold uppercase text-ink-400">{format(day, 'EEE')}</p>
              <p className={`text-sm font-bold ${isToday(day) ? 'text-accent-600' : 'text-ink-800'}`}>{format(day, 'd')}</p>
            </div>
          ))}

          {/* Meal slot rows */}
          {SLOTS.map(slot => (
            <Fragment key={slot}>
              <div className="flex items-center text-[11px] font-semibold text-ink-500">
                {SLOT_LABEL[slot]}
              </div>
              {days.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd')
                const entry = entryFor(dateStr, slot)
                const eaten = eatenBy.get(`${dateStr}|${slot}`) ?? []
                const planLabel = entry?.recipe?.title ?? entry?.custom_title
                  ?? (entry?.ingredient?.name ? `${entry.ingredient_quantity ?? ''}${entry.ingredient_unit ?? ''} ${entry.ingredient.name}`.trim() : null)
                const filled = planLabel || eaten.length > 0
                // A div (not a button) so plan / eaten / add can each be their
                // own control without nesting buttons.
                return (
                  <div
                    key={`${slot}-${dateStr}`}
                    className={`min-h-[52px] rounded-lg border p-1 flex flex-col gap-0.5 ${
                      filled ? 'bg-cream-50 border-ink-200' : 'bg-cream-50 border-dashed border-ink-200'
                    }`}
                  >
                    {planLabel && (
                      <button
                        onClick={() => setTarget({ date: dateStr, slot, entry })}
                        className="text-left rounded px-1 py-0.5 hover:bg-accent-50 transition-colors">
                        <span className="text-[11px] font-medium text-ink-800 leading-tight line-clamp-2">📋 {planLabel}</span>
                        {entry!.servings !== 1 && <span className="text-[9px] text-ink-400 block">×{entry!.servings}</span>}
                      </button>
                    )}
                    {eaten.map(l => (
                      <button
                        key={l.id}
                        onClick={() => setEditLog(l)}
                        className="text-left rounded px-1 py-0.5 hover:bg-green-50 transition-colors">
                        <span className="text-[10px] text-green-700 leading-tight line-clamp-1">✓ {l.title}{l.calories ? ` · ${Math.round(l.calories)}` : ''}</span>
                      </button>
                    ))}
                    {/* Always allow adding a plan to the cell. */}
                    <button
                      onClick={() => setTarget({ date: dateStr, slot, entry })}
                      className="text-left rounded px-1 min-h-[20px] text-ink-300 hover:text-accent-600 transition-colors text-xs">
                      {filled ? '+ plan' : '+'}
                    </button>
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {target && (
        <AssignMealModal
          open
          onClose={() => setTarget(null)}
          date={target.date}
          mealSlot={target.slot}
          existing={target.entry}
        />
      )}
      {editLog && (
        <EditFoodLogModal meal={loggedToDayMeal(editLog)} date={editLog.date} onClose={() => setEditLog(null)} />
      )}
    </div>
  )
}
