import { useState } from 'react'
import { isToday } from 'date-fns'
import { useEatPlannedEntry } from '../../../recipes/hooks/useMealPlan'
import { Cell, CellHeader } from './cellKit'
import { WaterTracker } from './WaterTracker'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useEntityModal } from '../../../../shared/modals/useEntityModal'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { useDeleteQuickMeal, useCopyYesterdayMeals } from '../../hooks/useQuickMeals'
import { MacroBar } from '../../../recipes/components/MacroBar'
import { AssignMealModal } from '../../../recipes/components/AssignMealModal'
import { FoodLogModal } from '../../../recipes/components/FoodLogModal'
import { EditFoodLogModal } from '../../../recipes/components/EditFoodLogModal'
import { useRecentFoods, useAddFoodLogEntries, useDeleteFoodLogEntry } from '../../../recipes/hooks/useFoodLog'
import { useIngredientLibrary } from '../../../recipes/hooks/useIngredientLibrary'
import { ingredientSnapshot, type RecentFood } from '../../../recipes/api/foodLogApi'
import type { MealSlot, FoodLogEntryInput, MealPlanEntry } from '../../../recipes/types'
import type { DayMeal } from '../../api/dayNutritionApi'

// Re-log a previously-eaten food into a given slot, carrying its ORIGINAL
// snapshot macros forward (no re-computation — that's the diary contract).
function reLogEntry(r: RecentFood, date: string, slot: MealSlot): FoodLogEntryInput {
  return {
    date, meal_slot: slot,
    library_ingredient_id: r.library_ingredient_id,
    recipe_id:             r.recipe_id,
    custom_title:          r.custom_title,
    quantity:              r.quantity,
    unit:                  r.unit,
    calories:              r.calories,
    protein_g:             r.protein_g,
    carbs_g:               r.carbs_g,
    fat_g:                 r.fat_g,
    fiber_g:               r.fiber_g,
    sugar_g:               r.sugar_g,
  }
}

// Slot icons + "now" highlighting folded in from the old separate Meals card —
// this card now presents nutrition AND the meal timeline as one widget.
const SLOTS: { slot: MealSlot; label: string; icon: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast', icon: '🌅' },
  { slot: 'lunch',      label: 'Lunch',     icon: '☀️' },
  { slot: 'dinner',     label: 'Dinner',    icon: '🌙' },
  { slot: 'snack',      label: 'Snack',     icon: '🍎' },
  { slot: 'supplement', label: 'Suppl.',    icon: '💊' },
]

// The slot matching the current time of day (only meaningful on today).
function currentSlot(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

function CalorieRing({ consumed, target }: { consumed: number; target: number }) {
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0
  const R = 30, C = 2 * Math.PI * R
  const remaining = Math.max(target - consumed, 0)
  const over = consumed > target
  return (
    <div className="relative w-[80px] h-[80px] shrink-0">
      <svg viewBox="0 0 72 72" className="w-full h-full -rotate-90">
        <circle cx="36" cy="36" r={R} fill="none" stroke="rgb(var(--ink-100))" strokeWidth="7" />
        <circle cx="36" cy="36" r={R} fill="none" stroke={over ? '#f87171' : 'rgb(var(--accent-500))'}
          strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold text-ink-900 leading-none">{remaining}</span>
        <span className="text-[9px] text-ink-500 mt-0.5">{over ? 'over' : 'left'}</span>
      </div>
    </div>
  )
}

// One slot row: filled → title + kcal + remove; empty → inline quick-add with
// recent-food chips. Every fast-path add now writes a REAL-macro diary row
// (food_log_entries), not a macro-less plan title — a recent chip re-logs its
// own snapshot; free text that matches your library logs that ingredient;
// anything else opens the full logger prefilled (so it still gets macros).
function SlotRow({ date, slot, label, icon, isNow, meals }: {
  date: string; slot: MealSlot; label: string; icon: string; isNow: boolean
  meals: DayMeal[]
}) {
  const [adding, setAdding] = useState(false)
  const [editPlan, setEditPlan] = useState<MealPlanEntry | null>(null)   // ✎ on an existing PLAN row
  const [editLog, setEditLog]   = useState<DayMeal | null>(null)         // ✎ on a logged (diary) row
  const [logOpen, setLogOpen] = useState(false)      // full logger (diary)
  const [logQuery, setLogQuery] = useState('')
  const [text, setText] = useState('')
  const { data: recent = [] } = useRecentFoods()
  const { data: library = [] } = useIngredientLibrary()
  const addEntries = useAddFoodLogEntries()
  const delMeal = useDeleteQuickMeal()
  const delLog  = useDeleteFoodLogEntry()
  const eatPlan = useEatPlannedEntry()

  function reset() { setAdding(false); setText('') }

  // Free text → log the matching library ingredient (default portion), else
  // hand off to the full logger so a new food gets real macros once.
  function save(title: string) {
    const t = title.trim()
    if (!t) return
    const lc = t.toLowerCase()
    // Auto-log ONLY on an exact or start-of-name match; a loose substring match
    // silently logged the wrong food ("egg" → "eggplant"), so fall through to
    // the full logger (prefilled) for anything less certain (Faz 9 fix).
    const match = library.find(i => i.name.toLowerCase() === lc)
             ?? library.find(i => i.name.toLowerCase().startsWith(lc))
    if (match) {
      const grams = match.serving_grams ?? 100
      addEntries.mutate([{ date, meal_slot: slot, library_ingredient_id: match.id, quantity: grams, unit: 'g', ...ingredientSnapshot(match, grams) }], { onSuccess: reset })
    } else {
      setLogQuery(t); setLogOpen(true); reset()
    }
  }

  function reLog(r: RecentFood) {
    addEntries.mutate([reLogEntry(r, date, slot)], { onSuccess: reset })
  }

  return (
    <li className="text-xs">
      {meals.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {meals.map((meal, i) => (
            <div key={meal.id} className="flex items-center gap-1 min-h-[44px]">
              <span className={`w-[4.5rem] shrink-0 flex items-center gap-1 ${isNow ? 'text-accent-700 font-semibold' : 'text-ink-500'}`}>
                {i === 0 && <><span className="leading-none">{icon}</span>{label}{isNow && <span className="text-[9px] font-normal text-accent-500">·now</span>}</>}
              </span>
              <span className="text-ink-700 flex-1 truncate">{meal.title}</span>
              {meal.calories > 0 && <span className="text-ink-500 shrink-0 pr-1">{meal.calories} kcal</span>}
              {meal.source === 'plan' && meal.planEntry && (
                <button onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
                  title="I ate this — count it" aria-label="Mark eaten"
                  className="text-green-600 hover:bg-green-50 rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 disabled:opacity-50">✓</button>
              )}
              <button
                onClick={() => meal.source === 'plan' ? setEditPlan(meal.planEntry!) : setEditLog(meal)}
                className="text-ink-500 hover:text-accent-600 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                title={meal.source === 'plan' ? 'Edit planned meal' : 'Edit logged food (amount / macros)'}
              >✎</button>
              {/* Three 44px targets + the slot label leave ~90px for the title on
                  a 393px phone, so ✕ is desktop-only: both editors this row opens
                  (EditFoodLogModal / AssignMealModal) already carry Delete. */}
              <button
                onClick={() => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)}
                className="hidden sm:flex text-ink-500 hover:text-red-500 min-w-[44px] min-h-[44px] items-center justify-center shrink-0"
                aria-label={`Remove ${meal.title}`}
              >✕</button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 min-h-[44px]">
            <span className={`w-[4.5rem] shrink-0 flex items-center gap-1 ${isNow ? 'text-accent-700 font-semibold' : 'text-ink-500'}`}>
              <span className="leading-none">{icon}</span>{label}{isNow && <span className="text-[9px] font-normal text-accent-500">·now</span>}
            </span>
            {adding ? (
              <input
                autoFocus value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(text); if (e.key === 'Escape') reset() }}
                onBlur={() => { if (!text.trim()) reset() }}
                placeholder="Type a food…"
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-accent-300 bg-cream-50 focus:outline-none focus:ring-1 focus:ring-accent-400 min-h-[44px]"
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex-1 text-left text-ink-500 hover:text-accent-600 transition-colors min-h-[44px]"
              >+ add</button>
            )}
            {adding && (
              <button
                onClick={() => { setLogQuery(text.trim()); setLogOpen(true); reset() }}
                className="text-ink-500 hover:text-accent-600 min-w-[44px] min-h-[44px] shrink-0"
                title="Build a meal (pick ingredients, grams, macros)"
              >⋯</button>
            )}
          </div>
          {adding && recent.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 pl-[4.5rem]">
              {recent.slice(0, 5).map(r => (
                <button key={r.key} onClick={() => reLog(r)}
                  className="px-2.5 rounded-full border border-ink-200 text-[10px] text-ink-600 hover:border-accent-300 min-h-[44px]">
                  {r.title}{r.protein_g != null && r.protein_g > 0 && <span className="text-ink-500"> · {Math.round(r.protein_g)}p</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {/* Full diary logger, prefilled to this slot (and any typed text). */}
      {logOpen && <FoodLogModal open onClose={() => setLogOpen(false)} date={date} defaultSlot={slot} defaultQuery={logQuery} />}
      {/* ✎ edits an existing PLANNED entry (status='planned') in the full
          planner — planning a future day still lives here. */}
      {editPlan && (
        <AssignMealModal open onClose={() => setEditPlan(null)} date={date} mealSlot={slot} existing={editPlan} />
      )}
      {editLog && (
        <EditFoodLogModal meal={editLog} date={date} onClose={() => setEditLog(null)} />
      )}
    </li>
  )
}

export function NutritionCard({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets } = useDayTargets()
  const coach = useNutritionCoach(date, targets)
  const copyYesterday = useCopyYesterdayMeals()
  const modal = useEntityModal()
  // The goals editor (draft → Save, per-goal profiles, coach suggestions) is
  // the shared `day-targets` popup — one copy instead of one per card.
  const openGoals = () => modal.open({ kind: 'day-targets', date })

  const [logOpen, setLogOpen] = useState(false)
  // Empty day → compact one-liner IN PLACE (the cell never moves or grows
  // unless the user expands it or logs something).
  const [expanded, setExpanded] = useState(false)
  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinPct = targets.protein > 0 ? Math.min(Math.round((protein / targets.protein) * 100), 100) : 0
  // A slot can now hold MANY rows (planned meal + individually logged foods).
  const mealsBySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = mealsBySlot.get(m.meal_slot) ?? []
    arr.push(m)
    mealsBySlot.set(m.meal_slot, arr)
  }
  const filledSlots = new Set(mealsBySlot.keys())

  const hasMeals = (nut?.meals?.length ?? 0) > 0
  // Highlight the current time-of-day slot on today only (folded in from the
  // old Meals card so "what's next to eat" still reads at a glance).
  const now = isToday(new Date(date + 'T00:00:00')) ? currentSlot() : null

  return (
    <Cell>
      <CellHeader
        icon="🍽️" title="Nutrition"
        action={
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => setLogOpen(true)}
              className="text-[11px] font-semibold text-accent-600 hover:text-accent-700 min-h-[44px] px-2 rounded transition-colors"
              title="Log food — pick ingredients from your library, grams, done">
              + Log
            </button>
          </div>
        }
      />

      {/* Hydration — always visible (independent of meals), consistent per day. */}
      <div className="pb-1 mb-1 border-b border-ink-100">
        <WaterTracker date={date} />
      </div>

      {hasMeals || expanded ? (
        <>
          <div className="flex items-center gap-3">
            <CalorieRing consumed={consumed} target={targets.calories} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-700">
                <strong className="text-ink-900">{consumed}</strong>
                <span className="text-ink-500"> / {targets.calories} kcal</span>
              </p>
              <div className="mt-1.5">
                <div className="flex items-center justify-between text-[11px] text-ink-500 mb-1">
                  <span>Protein</span>
                  <span><strong className="text-ink-800">{protein}g</strong> / {targets.protein}g</span>
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${proteinPct}%` }} />
                </div>
                {coach.proteinPerMealG != null && (
                  <p className="text-[10px] text-ink-500 mt-1">≈{coach.proteinPerMealG}g protein per meal spreads it best</p>
                )}
              </div>
              {(nut && nut.calories > 0) && (
                <div className="mt-2">
                  <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                  {nut.fiber_g > 0 && (
                    <p className="text-[10px] text-ink-500 mt-1">🌾 Fiber {nut.fiber_g}g <span className="text-ink-500">/ ~{Math.round((targets.calories / 1000) * 14)}g goal</span></p>
                  )}
                </div>
              )}
            </div>
          </div>

          <ul className="flex flex-col gap-0.5 pt-1 border-t border-ink-100">
            {SLOTS.map(({ slot, label, icon }) => (
              <SlotRow key={slot} date={date} slot={slot} label={label} icon={icon} isNow={slot === now} meals={mealsBySlot.get(slot) ?? []} />
            ))}
          </ul>

          {/* Footer meta — secondary tools demoted out of the header */}
          <div className="flex items-center justify-end gap-1 border-t border-ink-100 pt-1.5 -mb-1">
            {filledSlots.size < SLOTS.length && (
              <button
                onClick={() => copyYesterday.mutate({ date, filledSlots })}
                disabled={copyYesterday.isPending}
                className="text-[10px] text-ink-500 hover:text-accent-600 min-h-[44px] px-2 rounded transition-colors disabled:opacity-50"
                title="Copy yesterday's meals into empty slots"
              >⧉ Yesterday</button>
            )}
            <button onClick={openGoals}
              className="text-[10px] text-ink-500 hover:text-ink-700 min-h-[44px] px-2 rounded transition-colors">
              Goals
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1 py-0.5">
          <p className="text-xs text-ink-500">Nothing logged yet · goal {targets.calories} kcal / {targets.protein}g protein</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setExpanded(true)}
              className="text-xs text-ink-500 hover:text-accent-600 text-left min-h-[44px] transition-colors">
              Meal slots ▾
            </button>
            <button onClick={openGoals}
              className="text-xs text-ink-500 hover:text-ink-700 min-h-[44px] transition-colors">
              Goals
            </button>
          </div>
        </div>
      )}
      {logOpen && <FoodLogModal open onClose={() => setLogOpen(false)} date={date} />}
    </Cell>
  )
}
