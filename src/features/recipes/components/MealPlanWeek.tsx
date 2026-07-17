import { useState, Fragment } from 'react'
import { format, addDays, addWeeks, startOfWeek, endOfWeek, isToday, getISOWeek } from 'date-fns'
import { useMealPlan } from '../hooks/useMealPlan'
import { AssignMealModal } from './AssignMealModal'
import { DateNav } from '../../../shared/components/DateNav'
import type { MealSlot, MealPlanEntry } from '../types'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

interface CellTarget { date: string; slot: MealSlot; entry: MealPlanEntry | null }

export function MealPlanWeek() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [target, setTarget] = useState<CellTarget | null>(null)

  const baseStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekStart = weekOffset === 0 ? baseStart : addWeeks(baseStart, weekOffset)
  const weekEnd   = endOfWeek(weekStart, { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const { data: entries = [] } = useMealPlan(format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd'))

  function entryFor(dateStr: string, slot: MealSlot): MealPlanEntry | null {
    return entries.find(e => e.date === dateStr && e.meal_slot === slot) ?? null
  }

  return (
    <div>
      {/* Week nav */}
      {/* App-standard ‹ label › date navigation (shared DateNav) */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-1">
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

      {/* Grid — meal slots as rows, days as columns. min-w-[720px] means this
          always needs horizontal scroll below ~720px viewports; scroll-fade-x
          is at least a visible hint that it does (previously silent). */}
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
                const label = entry?.recipe?.title ?? entry?.custom_title
                  ?? (entry?.ingredient?.name ? `${entry.ingredient_quantity ?? ''}${entry.ingredient_unit ?? ''} ${entry.ingredient.name}`.trim() : null)
                return (
                  <button
                    key={`${slot}-${dateStr}`}
                    onClick={() => setTarget({ date: dateStr, slot, entry })}
                    className={`min-h-[52px] rounded-lg border p-1.5 text-left transition-colors ${
                      label ? 'bg-cream-50 border-ink-200 hover:border-accent-300' : 'bg-cream-50 border-dashed border-ink-200 hover:border-accent-300'
                    }`}
                  >
                    {label ? (
                      <>
                        <p className="text-[11px] font-medium text-ink-800 leading-tight line-clamp-2">{label}</p>
                        {entry!.servings !== 1 && <p className="text-[9px] text-ink-400 mt-0.5">×{entry!.servings}</p>}
                      </>
                    ) : (
                      <span className="text-ink-300 text-xs">+</span>
                    )}
                  </button>
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
    </div>
  )
}
