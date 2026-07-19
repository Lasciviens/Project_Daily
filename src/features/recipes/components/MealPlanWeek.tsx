import { useState, Fragment } from 'react'
import { format, addDays, addWeeks, startOfWeek, endOfWeek, isToday, getISOWeek } from 'date-fns'
import { useMealPlan, useEatPlannedEntry } from '../hooks/useMealPlan'
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
  // Mobile shows ONE day at a time (the 7×5 grid is unusable at 393px). Default
  // to today's weekday (Mon-based index).
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7)
  const eat = useEatPlannedEntry()

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

      {/* ── MOBILE: one day at a time (the 720px grid is unusable at 393px) ── */}
      <div className="md:hidden">
        {/* Day picker */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1 mb-3">
          {days.map((day, i) => (
            <button key={day.toISOString()} onClick={() => setDayIdx(i)}
              className={`press-feedback shrink-0 min-w-[46px] rounded-xl px-2 py-1.5 border text-center transition-colors ${
                i === dayIdx ? 'bg-accent-500 border-accent-500 text-white'
                  : `bg-cream-50 text-ink-600 ${isToday(day) ? 'border-accent-300' : 'border-ink-200'}`
              }`}>
              <div className="text-[9px] font-semibold uppercase opacity-80">{format(day, 'EEE')}</div>
              <div className="text-sm font-bold leading-tight">{format(day, 'd')}</div>
            </button>
          ))}
        </div>
        {/* Selected day's slots as stacked cards (same style as Food → Today) */}
        <div className="flex flex-col gap-2.5 stagger-in">
          {SLOTS.map(slot => {
            const dateStr = format(days[dayIdx], 'yyyy-MM-dd')
            const entry = entryFor(dateStr, slot)
            const eaten = eatenBy.get(`${dateStr}|${slot}`) ?? []
            const planLabel = entry?.recipe?.title ?? entry?.custom_title
              ?? (entry?.ingredient?.name ? `${entry.ingredient_quantity ?? ''}${entry.ingredient_unit ?? ''} ${entry.ingredient.name}`.trim() : null)
            const openPlan = () => setTarget({ date: dateStr, slot, entry })
            return (
              <div key={slot} className="rounded-2xl border border-ink-200 bg-cream-50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-100">
                  <span className="text-sm font-semibold text-ink-800 flex-1">{SLOT_LABEL[slot]}</span>
                  <button onClick={openPlan} className="press-feedback text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[32px] px-2 rounded-lg">+ Add</button>
                </div>
                {planLabel || eaten.length > 0 ? (
                  <ul className="divide-y divide-ink-50">
                    {planLabel && (
                      <li className="flex items-center gap-1.5 px-4 py-1.5 min-h-[44px] text-sm">
                        <button onClick={openPlan} className="flex items-center gap-2 flex-1 min-w-0 text-left min-h-[40px]">
                          <span className="flex-1 min-w-0 truncate text-ink-400 italic">📋 {planLabel}{entry!.servings !== 1 ? ` ×${entry!.servings}` : ''}</span>
                          <span className="text-[9px] uppercase tracking-wide text-ink-300 border border-ink-200 rounded px-1 shrink-0">planned</span>
                        </button>
                        <button onClick={() => eat.mutate(entry!)} disabled={eat.isPending} aria-label="Mark eaten" title="I ate this — count it"
                          className="min-w-[28px] min-h-[28px] rounded-full text-green-600 hover:bg-green-50 shrink-0 disabled:opacity-50">✓</button>
                      </li>
                    )}
                    {eaten.map(l => (
                      <li key={l.id}>
                        <button onClick={() => setEditLog(l)} className="w-full flex items-center gap-2 px-4 py-1.5 min-h-[44px] text-sm text-left hover:bg-green-50/40 transition-colors">
                          <span className="flex-1 min-w-0 truncate text-ink-800">✓ {l.title}</span>
                          {l.calories ? <span className="text-xs text-ink-500 tabular-nums shrink-0">{Math.round(l.calories)} kcal</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button onClick={openPlan} className="w-full text-left px-4 py-2.5 text-xs text-ink-300 hover:text-accent-600 transition-colors">+ Plan a meal</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── DESKTOP: the full 7-day × 5-slot grid ── */}
      <div className="hidden md:block overflow-x-auto scrollbar-none scroll-fade-x">
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
                const filled = !!planLabel || eaten.length > 0
                const openPlan = () => setTarget({ date: dateStr, slot, entry })
                // A div (not a button) so plan / eaten / add can each be their
                // own control without nesting buttons.
                return (
                  <div
                    key={`${slot}-${dateStr}`}
                    className={`min-h-[60px] rounded-lg border flex flex-col overflow-hidden ${
                      filled ? 'bg-cream-50 border-ink-200' : 'bg-cream-50 border-dashed border-ink-200'
                    }`}
                  >
                    {!filled ? (
                      // Empty → the WHOLE cell is a big centered + (per request).
                      <button onClick={openPlan}
                        className="flex-1 min-h-[60px] w-full flex items-center justify-center text-xl text-ink-300 hover:text-accent-600 hover:bg-accent-50/40 transition-colors">+</button>
                    ) : (
                      <>
                        <div className="flex flex-col gap-0.5 p-1 flex-1">
                          {planLabel && (
                            <div className="flex items-center gap-0.5 rounded hover:bg-accent-50 transition-colors">
                              <button onClick={openPlan} className="flex-1 min-w-0 text-left px-1 py-0.5">
                                <span className="text-[11px] font-medium text-ink-800 leading-tight line-clamp-2">📋 {planLabel}{entry!.servings !== 1 ? ` ×${entry!.servings}` : ''}</span>
                              </button>
                              {/* Confirm planned → eaten (starts counting). */}
                              <button onClick={() => eat.mutate(entry!)} disabled={eat.isPending}
                                aria-label="Mark eaten" title="I ate this — count it"
                                className="min-w-[24px] min-h-[24px] rounded-full text-green-600 hover:bg-green-100 shrink-0 text-xs disabled:opacity-50">✓</button>
                            </div>
                          )}
                          {eaten.map(l => (
                            <button key={l.id} onClick={() => setEditLog(l)}
                              className="text-left rounded px-1 py-0.5 hover:bg-green-50 transition-colors">
                              <span className="text-[10px] text-green-700 leading-tight line-clamp-1">✓ {l.title}{l.calories ? ` · ${Math.round(l.calories)}` : ''}</span>
                            </button>
                          ))}
                        </div>
                        {/* Filled → a full-width bottom row to add more (clickable). */}
                        <button onClick={openPlan}
                          className="w-full text-left px-2 py-1 text-[10px] text-ink-300 hover:text-accent-600 hover:bg-accent-50/40 border-t border-ink-100 transition-colors">＋ add</button>
                      </>
                    )}
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
