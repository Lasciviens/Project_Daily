import { useState } from 'react'
import { isToday } from 'date-fns'
import { Check, ChevronDown, Copy, MoreHorizontal, Pencil, Plus, UtensilsCrossed, X } from 'lucide-react'
import { AnimatedNumber, Button, ProgressRing, Truncate, cx } from '../../../../shared/ui'
import { useEatPlannedEntry } from '../../../recipes/hooks/useMealPlan'
import { Cell, CellHeader } from './cellKit'
import { WaterTracker } from './WaterTracker'
import { GoalSummary } from '../GoalSummary'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useEntityModal } from '../../../../shared/modals/useEntityModal'
import { useBodyweightSeries } from '../../../health/hooks/useBodyweight'
import { PROTEIN_PER_MEAL_PER_KG } from '../../../health/goal/cutDecision'
import { shiftDateStr } from '../../../../shared/utils/dateUtils'
import { useCopyYesterdayMeals } from '../../hooks/useQuickMeals'
import { MacroBar } from '../../../recipes/components/MacroBar'
import { MACRO_COLOR } from '../../../recipes/macroColors'
import { useRecentFoods, useAddFoodLogEntries, useRemoveFoodLogEntries } from '../../../recipes/hooks/useFoodLog'
import { foldText, parseQuickAdd, sortForSlot, usualForSlot } from '../../../recipes/foodSearch'
import { useIngredientLibrary } from '../../../recipes/hooks/useIngredientLibrary'
import { ingredientSnapshot, recentToEntry, type RecentFood } from '../../../recipes/api/foodLogApi'
import type { MealSlot } from '../../../recipes/types'
import type { DayMeal } from '../../api/dayNutritionApi'
import { useNewIds } from '../../../../shared/hooks/useNewIds'

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

function CalorieRing({ consumed, target, ready }: { consumed: number; target: number; ready: boolean }) {
  const over = consumed > target
  const remaining = Math.abs(target - consumed)
  return (
    <ProgressRing value={target > 0 ? consumed / target : 0} size={72} stroke={7} ready={ready}
      color={over ? 'rgb(var(--danger))' : MACRO_COLOR.calories} className="h-[80px] w-[80px]">
      <AnimatedNumber value={remaining} ready={ready} align="center" className="text-lead font-bold leading-none text-fg" />
      <span className="mt-0.5 text-micro text-fg-muted">{over ? 'over' : 'left'}</span>
    </ProgressRing>
  )
}

// One slot row: filled → title + kcal + remove; empty → inline quick-add with
// recent-food chips. Every fast-path add now writes a REAL-macro diary row
// (food_log_entries), not a macro-less plan title — a recent chip re-logs its
// own snapshot; free text that matches your library logs that ingredient;
// anything else opens the full logger prefilled (so it still gets macros).
function SlotRow({ date, slot, label, icon, isNow, meals, fresh }: {
  date: string; slot: MealSlot; label: string; icon: string; isNow: boolean
  meals: DayMeal[]
  /** Rows logged while the card is on screen (they rise in). */
  fresh: ReadonlySet<string>
}) {
  const modal = useEntityModal()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const { data: recent = [] } = useRecentFoods()
  const { data: library = [] } = useIngredientLibrary()
  const addEntries = useAddFoodLogEntries()
  const remove  = useRemoveFoodLogEntries()
  const eatPlan = useEatPlannedEntry()

  function reset() { setAdding(false); setText('') }
  const slotRecent = sortForSlot(recent, slot)
  const usual = usualForSlot(recent, slot)
  const openLogger = (query?: string) => modal.open({ kind: 'food-log', date, slot, query: query || undefined })

  // Free text: "kebab 700 kcal" logs a one-off line; an EXACT library name
  // logs that food (its portion, or "150g" if typed); anything else — a loose
  // match ("egg" ≠ "Eggplant") or a bare number ("Chicken 150": kcal or grams?)
  // — opens the full logger prefilled, so nothing is guessed.
  function save(title: string) {
    const t = title.trim()
    if (!t) return
    const quick = parseQuickAdd(t)
    if (quick.kcal != null) {
      addEntries.mutate([{ date, meal_slot: slot, custom_title: quick.title, calories: quick.kcal }], { onSuccess: reset })
      return
    }
    const name = foldText(quick.title)
    const match = quick.amount == null ? library.find(i => foldText(i.name) === name) : undefined
    if (match) {
      const grams = quick.grams ?? match.serving_grams ?? 100
      const unit = match.unit?.trim() || 'g'
      addEntries.mutate([{ date, meal_slot: slot, library_ingredient_id: match.id, quantity: grams, unit, ...ingredientSnapshot(match, grams) }], { onSuccess: reset })
    } else {
      openLogger(t); reset()
    }
  }

  function reLog(r: RecentFood) {
    addEntries.mutate([recentToEntry(r, date, slot)], { onSuccess: reset })
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
            <div key={meal.id} className={cx('flex min-h-[44px] items-center gap-2', fresh.has(meal.id) && 'motion-row-in')}>
              {i === 0 ? slotLabel : <span className="w-[5.75rem] shrink-0" />}
              <Truncate className={cx('flex-1', meal.source === 'plan' ? 'italic text-fg-muted' : 'text-fg-2')}>{meal.title}</Truncate>
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
                onClick={() => remove.mutate({ ids: [meal.id], label: meal.title })}
                className={cx(iconBtn, 'hidden hover:text-danger sm:grid')}
                aria-label={`Remove ${meal.title}`}
              ><X className="h-4 w-4" aria-hidden /></button>
            </div>
          ))}
        </div>
      ) : null}
      {(meals.length === 0 || adding) ? (
        <>
          <div className="flex min-h-[44px] items-center gap-2">
            {meals.length === 0 ? slotLabel : <span className="w-[5.75rem] shrink-0" />}
            {adding ? (
              <input
                autoFocus value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(text); if (e.key === 'Escape') reset() }}
                onBlur={() => { if (!text.trim()) reset() }}
                placeholder="Type a food, or “kebab 700”…"
                aria-label={`Add to ${label}`}
                className="input min-w-0 flex-1"
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)}
                className="flex min-h-[44px] flex-1 items-center gap-1 text-left text-fg-faint transition-colors hover:text-accent-600">
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add
              </button>
            )}
            {!adding && meals.length === 0 && usual.length > 0 && (
              <button type="button" disabled={addEntries.isPending}
                onClick={() => addEntries.mutate(usual.map(r => recentToEntry(r, date, slot)))}
                title={usual.map(r => r.title).join(', ')}
                className="chip min-h-[44px] max-w-[11rem] shrink-0 truncate px-2.5 text-meta hover:bg-surface-hover disabled:opacity-50">
                Log usual ({usual.length})
              </button>
            )}
            {adding && (
              <button type="button" onClick={() => { openLogger(text.trim()); reset() }}
                className={iconBtn} aria-label="Build a meal (ingredients, grams, macros)">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {adding && slotRecent.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 pl-[6.25rem]">
              {slotRecent.slice(0, 5).map(r => (
                <button key={r.key} type="button" onMouseDown={e => e.preventDefault()} onClick={() => reLog(r)}
                  className="chip min-h-[44px] px-2.5 hover:bg-surface-hover">
                  <Truncate>{r.title}</Truncate>{r.protein_g != null && r.protein_g > 0 && <span className="shrink-0 text-fg-muted">· {Math.round(r.protein_g)}p</span>}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        // A filled slot can still take one more item without the full logger.
        <div className="flex min-h-[36px] items-center gap-2">
          <span className="w-[5.75rem] shrink-0" />
          <button type="button" onClick={() => setAdding(true)} aria-label={`Add more to ${label}`}
            className="flex min-h-[36px] items-center gap-1 text-meta text-fg-faint transition-colors hover:text-accent-600">
            <Plus className="h-3 w-3" aria-hidden /> Add more
          </button>
        </div>
      )}
    </li>
  )
}

export function NutritionCard({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets } = useDayTargets()
  // Per-meal protein only needs the week's weight (the coach itself lives on Food and in the goal editor).
  const { data: weights = [] } = useBodyweightSeries(shiftDateStr(date, -6), date)
  const weekKg = weights.length ? weights.reduce((a, w) => a + w.kg, 0) / weights.length : null
  const proteinPerMealG = weekKg ? Math.round((weekKg * PROTEIN_PER_MEAL_PER_KG) / 5) * 5 : null
  const copyYesterday = useCopyYesterdayMeals()
  const modal = useEntityModal()
  // The goal (phase, daily targets, body targets) is ONE row edited in the
  // shared `day-targets` popup — GoalSummary shows it and opens it.

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
  const fresh = useNewIds((nut?.meals ?? []).map(m => m.id), date, nut != null)

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
            <CalorieRing consumed={consumed} target={targets.calories} ready={nut != null} />
            <div className="min-w-0 flex-1">
              <p className="text-body tabular-nums text-fg-2">
                <AnimatedNumber value={consumed} ready={nut != null} className="text-lead font-bold text-fg" />
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
                {proteinPerMealG != null && (
                  <p className="mt-1 text-meta text-fg-muted">≈{proteinPerMealG}g protein per meal spreads it best</p>
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
              <SlotRow key={slot} date={date} slot={slot} label={label} icon={icon} isNow={slot === now} meals={mealsBySlot.get(slot) ?? []} fresh={fresh} />
            ))}
          </ul>

          <div className="-mb-1 flex flex-wrap items-center justify-end gap-x-2 border-t border-line pt-1.5">
            <GoalSummary date={date} className="min-w-0 basis-full sm:basis-0 sm:flex-1" />
            {filledSlots.size < SLOTS.length && (
              <button
                type="button"
                onClick={() => copyYesterday.mutate({ date, filledSlots })}
                disabled={copyYesterday.isPending}
                className={cx(footBtn, 'flex items-center gap-1')}
                title="Copy yesterday's meals into empty slots"
              ><Copy className="h-3.5 w-3.5" aria-hidden /> Yesterday</button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-body text-fg-muted">Nothing logged yet</p>
          <GoalSummary date={date} />
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setExpanded(true)} className={cx(footBtn, '-ml-2.5 flex items-center gap-1')} aria-expanded={false}>
              Meal slots <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => copyYesterday.mutate({ date, filledSlots })}
              disabled={copyYesterday.isPending}
              className={cx(footBtn, 'flex items-center gap-1')}
              title="Log the same meals as yesterday"
            ><Copy className="h-3.5 w-3.5" aria-hidden /> Same as yesterday</button>
          </div>
        </div>
      )}
    </Cell>
  )
}
