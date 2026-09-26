import { useState } from 'react'
import { isToday } from 'date-fns'
import { Check, ChevronDown, Copy, MoreHorizontal, Pencil, Plus, Target, UtensilsCrossed, X } from 'lucide-react'
import { Button, cx } from '../../../../shared/ui'
import { useEatPlannedEntry } from '../../../recipes/hooks/useMealPlan'
import { Cell, CellHeader } from './cellKit'
import { WaterTracker } from './WaterTracker'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useEntityModal } from '../../../../shared/modals/useEntityModal'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { useDeleteQuickMeal, useCopyYesterdayMeals } from '../../hooks/useQuickMeals'
import { MacroBar } from '../../../recipes/components/MacroBar'
import { MACRO_COLOR } from '../../../recipes/macroColors'
import { useRecentFoods, useAddFoodLogEntries, useDeleteFoodLogEntry } from '../../../recipes/hooks/useFoodLog'
import { useIngredientLibrary } from '../../../recipes/hooks/useIngredientLibrary'
import { ingredientSnapshot, type RecentFood } from '../../../recipes/api/foodLogApi'
import type { MealSlot, FoodLogEntryInput } from '../../../recipes/types'
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
    <div className="relative h-[80px] w-[80px] shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="36" cy="36" r={R} fill="none" className="stroke-surface-2" strokeWidth="7" />
        <circle cx="36" cy="36" r={R} fill="none" className={over ? 'stroke-danger' : undefined}
          style={over ? undefined : { stroke: MACRO_COLOR.calories }}
          strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lead font-bold leading-none tabular-nums text-fg">{remaining}</span>
        <span className="mt-0.5 text-micro text-fg-muted">{over ? 'over' : 'left'}</span>
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
  const modal = useEntityModal()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const { data: recent = [] } = useRecentFoods()
  const { data: library = [] } = useIngredientLibrary()
  const addEntries = useAddFoodLogEntries()
  const delMeal = useDeleteQuickMeal()
  const delLog  = useDeleteFoodLogEntry()
  const eatPlan = useEatPlannedEntry()

  function reset() { setAdding(false); setText('') }
  const openLogger = (query?: string) => modal.open({ kind: 'food-log', date, slot, query: query || undefined })

  // Free text → log the matching library ingredient (default portion), else
  // hand off to the full logger so a new food gets real macros once.
  function save(title: string) {
    const t = title.trim()
    if (!t) return
    const lc = t.toLowerCase()
    // Auto-log ONLY on an exact or start-of-name match; a loose substring match
    // silently logged the wrong food ("egg" → "eggplant").
    const match = library.find(i => i.name.toLowerCase() === lc)
             ?? library.find(i => i.name.toLowerCase().startsWith(lc))
    if (match) {
      const grams = match.serving_grams ?? 100
      addEntries.mutate([{ date, meal_slot: slot, library_ingredient_id: match.id, quantity: grams, unit: 'g', ...ingredientSnapshot(match, grams) }], { onSuccess: reset })
    } else {
      openLogger(t); reset()
    }
  }

  function reLog(r: RecentFood) {
    addEntries.mutate([reLogEntry(r, date, slot)], { onSuccess: reset })
  }

  function edit(meal: DayMeal) {
    if (meal.source === 'plan' && meal.planEntry) modal.open({ kind: 'meal-plan', date, slot, entryId: meal.planEntry.id })
    else modal.open({ kind: 'food-log-edit', entryId: meal.id, date })
  }

  const slotLabel = (
    <span className={cx('flex w-[5.75rem] shrink-0 items-center gap-1.5', isNow ? 'font-semibold text-accent-600' : 'text-fg-muted')}>
      <span className="leading-none">{icon}</span>{label}
      {isNow && <span className="sr-only">(now)</span>}
    </span>
  )
  const iconBtn = 'grid min-h-[44px] min-w-[40px] shrink-0 place-items-center rounded-control text-fg-muted transition-colors hover:bg-surface-hover'

  return (
    <li className="text-body">
      {meals.length > 0 ? (
        <div className="flex flex-col">
          {meals.map((meal, i) => (
            <div key={meal.id} className="flex min-h-[44px] items-center gap-2">
              {i === 0 ? slotLabel : <span className="w-[5.75rem] shrink-0" />}
              <span className={cx('flex-1 truncate', meal.source === 'plan' ? 'italic text-fg-muted' : 'text-fg-2')}>{meal.title}</span>
              {meal.calories > 0 && <span className="shrink-0 pr-1 text-meta tabular-nums text-fg-muted">{meal.calories} kcal</span>}
              {meal.source === 'plan' && meal.planEntry && (
                <button type="button" onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
                  aria-label="Mark eaten" title="I ate this — count it"
                  className={cx(iconBtn, 'hover:text-success disabled:opacity-50')}><Check className="h-4 w-4" aria-hidden /></button>
              )}
              <button type="button" onClick={() => edit(meal)} className={cx(iconBtn, 'hover:text-accent-600')}
                aria-label={meal.source === 'plan' ? 'Edit planned meal' : 'Edit logged food'}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              {/* Desktop-only: three 44px targets leave too little title room on
                  a 393px phone, and both editors this row opens carry Delete. */}
              <button
                type="button"
                onClick={() => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)}
                className={cx(iconBtn, 'hidden hover:text-danger sm:grid')}
                aria-label={`Remove ${meal.title}`}
              ><X className="h-4 w-4" aria-hidden /></button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex min-h-[44px] items-center gap-2">
            {slotLabel}
            {adding ? (
              <input
                autoFocus value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(text); if (e.key === 'Escape') reset() }}
                onBlur={() => { if (!text.trim()) reset() }}
                placeholder="Type a food…"
                aria-label={`Add to ${label}`}
                className="input min-w-0 flex-1"
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)}
                className="flex min-h-[44px] flex-1 items-center gap-1 text-left text-fg-faint transition-colors hover:text-accent-600">
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add
              </button>
            )}
            {adding && (
              <button type="button" onClick={() => { openLogger(text.trim()); reset() }}
                className={iconBtn} aria-label="Build a meal (ingredients, grams, macros)">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {adding && recent.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 pl-[6.25rem]">
              {recent.slice(0, 5).map(r => (
                <button key={r.key} type="button" onMouseDown={e => e.preventDefault()} onClick={() => reLog(r)}
                  className="chip min-h-[44px] px-2.5 hover:bg-surface-hover">
                  {r.title}{r.protein_g != null && r.protein_g > 0 && <span className="text-fg-muted"> · {Math.round(r.protein_g)}p</span>}
                </button>
              ))}
            </div>
          )}
        </>
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

  const footBtn = 'min-h-[44px] rounded-control px-2.5 text-meta font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50'

  return (
    <Cell>
      <CellHeader
        icon={<UtensilsCrossed />} title="Nutrition"
        action={<Button size="sm" variant="ghost" icon={<Plus />} onClick={() => modal.open({ kind: 'food-log', date })}>Log</Button>}
      />

      {/* Hydration — always visible (independent of meals). */}
      <div className="border-b border-line pb-2">
        <WaterTracker date={date} />
      </div>

      {hasMeals || expanded ? (
        <>
          <div className="flex items-center gap-3">
            <CalorieRing consumed={consumed} target={targets.calories} />
            <div className="min-w-0 flex-1">
              <p className="text-body tabular-nums text-fg-2">
                <strong className="text-lead text-fg">{consumed}</strong>
                <span className="text-fg-muted"> / {targets.calories} kcal</span>
              </p>
              <div className="mt-1.5">
                <div className="mb-1 flex items-center justify-between text-meta text-fg-muted">
                  <span>Protein</span>
                  <span className="tabular-nums"><strong className="text-fg">{protein}g</strong> / {targets.protein}g</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${proteinPct}%`, backgroundColor: MACRO_COLOR.protein }} />
                </div>
                {coach.proteinPerMealG != null && (
                  <p className="mt-1 text-meta text-fg-muted">≈{coach.proteinPerMealG}g protein per meal spreads it best</p>
                )}
              </div>
              {(nut && nut.calories > 0) && (
                <div className="mt-2">
                  <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                  {nut.fiber_g > 0 && (
                    <p className="mt-1 text-meta tabular-nums text-fg-muted">Fiber {nut.fiber_g}g / ~{Math.round((targets.calories / 1000) * 14)}g goal</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <ul className="flex flex-col border-t border-line pt-1">
            {SLOTS.map(({ slot, label, icon }) => (
              <SlotRow key={slot} date={date} slot={slot} label={label} icon={icon} isNow={slot === now} meals={mealsBySlot.get(slot) ?? []} />
            ))}
          </ul>

          <div className="-mb-1 flex items-center justify-end gap-1 border-t border-line pt-1.5">
            {filledSlots.size < SLOTS.length && (
              <button
                type="button"
                onClick={() => copyYesterday.mutate({ date, filledSlots })}
                disabled={copyYesterday.isPending}
                className={cx(footBtn, 'flex items-center gap-1')}
                title="Copy yesterday's meals into empty slots"
              ><Copy className="h-3.5 w-3.5" aria-hidden /> Yesterday</button>
            )}
            <button type="button" onClick={openGoals} className={cx(footBtn, 'flex items-center gap-1')}>
              <Target className="h-3.5 w-3.5" aria-hidden /> Goals
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-body tabular-nums text-fg-muted">Nothing logged yet · goal {targets.calories} kcal / {targets.protein}g protein</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setExpanded(true)} className={cx(footBtn, '-ml-2.5 flex items-center gap-1')} aria-expanded={false}>
              Meal slots <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" onClick={openGoals} className={cx(footBtn, 'flex items-center gap-1')}>
              <Target className="h-3.5 w-3.5" aria-hidden /> Goals
            </button>
          </div>
        </div>
      )}
    </Cell>
  )
}
