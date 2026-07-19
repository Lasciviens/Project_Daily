import { useState } from 'react'
import { format } from 'date-fns'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useNutritionCoach } from '../../daily/hooks/useNutritionCoach'
import { useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useDeleteQuickMeal } from '../../daily/hooks/useQuickMeals'
import { MacroBar } from './MacroBar'
import { FoodLogModal } from './FoodLogModal'
import { EditFoodLogModal } from './EditFoodLogModal'
import { AssignMealModal } from './AssignMealModal'
import { DateNav } from '../../../shared/components/DateNav'
import { formatLocalDate, shiftDateStr } from '../../../shared/utils/dateUtils'
import type { MealSlot, MealPlanEntry } from '../types'
import type { DayMeal } from '../../daily/api/dayNutritionApi'

// ─────────────────────────────────────────────────────────────────────────────
//  Food · Today — the FULL-SIZE expression of the Daily nutrition card, the
//  "asıl mevzu" the user wanted under Food: the same colourful ring + macro
//  bars + remaining coaching, plus each meal slot as a section of NAMED dish
//  rows with a per-slot log. The Daily card stays the quick glance; this is
//  where you actually run the day's food.
// ─────────────────────────────────────────────────────────────────────────────

const SLOTS: { slot: MealSlot; label: string; icon: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast',  icon: '🌅' },
  { slot: 'lunch',      label: 'Lunch',      icon: '☀️' },
  { slot: 'dinner',     label: 'Dinner',     icon: '🌙' },
  { slot: 'snack',      label: 'Snack',      icon: '🍎' },
  { slot: 'supplement', label: 'Supplement', icon: '💊' },
]

function Ring({ consumed, target }: { consumed: number; target: number }) {
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0
  const R = 52, C = 2 * Math.PI * R
  const remaining = Math.max(target - consumed, 0)
  const over = consumed > target
  return (
    <div className="relative w-[128px] h-[128px] shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(var(--ink-100))" strokeWidth="11" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={over ? '#f87171' : 'rgb(var(--accent-500))'}
          strokeWidth="11" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-ink-900 leading-none tabular-nums">{remaining}</span>
        <span className="text-[11px] text-ink-400 mt-0.5">{over ? 'over' : 'kcal left'}</span>
      </div>
    </div>
  )
}

export function FoodTodayTab() {
  const [date, setDate] = useState(() => formatLocalDate(new Date()))
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const coach = useNutritionCoach(date, targets)
  const delLog  = useDeleteFoodLogEntry()
  const delMeal = useDeleteQuickMeal()
  const [logSlot, setLogSlot] = useState<MealSlot | null>(null)
  const [editMeal, setEditMeal] = useState<DayMeal | null>(null)   // ✎ a logged (diary) row
  const [planMeal, setPlanMeal] = useState<MealPlanEntry | null>(null) // ✎ a planned row

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinPct = targets.protein > 0 ? Math.min(Math.round((protein / targets.protein) * 100), 100) : 0
  const proteinLeft = Math.round(targets.protein - protein)
  const proteinHit  = targets.protein > 0 && proteinLeft <= 0
  const fiberGoal   = Math.round((targets.calories / 1000) * 14)   // ~14g / 1000 kcal (dietitian rule)

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []; arr.push(m); bySlot.set(m.meal_slot, arr)
  }

  const d = new Date(date + 'T00:00:00')
  const isToday = date === formatLocalDate(new Date())

  return (
    <div className="max-w-2xl 2xl:max-w-4xl flex flex-col gap-4">
      {/* Date nav */}
      <DateNav
        label={isToday ? 'Today' : format(d, 'EEE, d MMM')}
        labelClassName="text-sm font-bold text-ink-900 min-w-[110px] text-center"
        onPrev={() => setDate(s => shiftDateStr(s, -1))}
        onNext={() => setDate(s => shiftDateStr(s, 1))}
        onToday={() => setDate(formatLocalDate(new Date()))}
        isToday={isToday}
      />

      {/* Hero — ring + macros + remaining (the Nutrition card, full size).
          Capped at 2xl even on huge monitors — a summary row shouldn't smear. */}
      <div className="rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden w-full max-w-2xl">
        <div className="h-1 bg-accent-500" />
        <div className="p-5 flex items-center gap-5 flex-wrap sm:flex-nowrap">
          <Ring consumed={consumed} target={targets.calories} />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm text-ink-700">
              <strong className="text-lg text-ink-900 tabular-nums">{consumed}</strong>
              <span className="text-ink-400"> / {targets.calories} kcal</span>
            </p>
            <div className="mt-2.5">
              <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span>Protein</span>
                <span><strong className="text-ink-800 tabular-nums">{protein}g</strong> / {targets.protein}g</span>
              </div>
              <div className="h-2.5 rounded-full bg-ink-100 overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${proteinPct}%` }} />
              </div>
            </div>
            {nut && nut.calories > 0 && (
              <div className="mt-3">
                <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                {/* Fiber + sugar — the two the dietitian flagged as invisible on
                    the full-size card (fiber has a goal, sugar is a watch-out). */}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] tabular-nums">
                  {/* Fiber always shows once anything is logged (it has a goal) —
                      "0g / ~Ng" is informative, not noise. */}
                  <span className="text-ink-500">🌾 Fiber <strong className="text-ink-700">{nut.fiber_g}g</strong><span className="text-ink-300"> / ~{fiberGoal}g</span></span>
                  {nut.sugar_g > 0 && (
                    <span className="text-ink-500">🍬 Sugar <strong className="text-ink-700">{nut.sugar_g}g</strong></span>
                  )}
                </div>
              </div>
            )}
            {/* The ring already shows kcal-left; here lead with protein (the #1
                adherence metric) — green when the goal is hit (overshoot is fine). */}
            <p className="text-[11px] mt-2.5 tabular-nums">
              {proteinHit
                ? <span className="text-green-600 font-medium">✓ Protein goal hit{proteinLeft < 0 ? ` (+${-proteinLeft}g)` : ''}</span>
                : <span className="text-ink-600">{proteinLeft}g protein left</span>}
              {coach.weightKg != null && coach.proteinForGoal != null && (
                <span className="text-ink-300"> · target {coach.proteinForGoal}g ({targets.goal})</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Coach — the dietitian/sports-science surface, ALWAYS shown so it's
          discoverable (was hidden entirely with no explanation when there was
          no bodyweight data). weightKg null → an actionable unlock CTA; gates
          unmet → the specific reason; else the applyable suggestions. */}
      <div className="rounded-2xl border border-accent-200 bg-accent-50/40 px-4 py-3 flex flex-col gap-1.5 text-xs max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-700">🧠 Coach</p>
        {coach.weightKg == null ? (
          <p className="text-ink-500">Add a bodyweight in <strong className="text-ink-700">Training → Body</strong> (or sync Apple Health) to unlock protein &amp; calorie coaching from your real weight trend.</p>
        ) : (
          <>
            {/* Calorie trend line: advice (applyable) / on-track / floor / the gate reason */}
            {coach.calorieAdvice ? (
              <button
                onClick={() => update({ calories: Math.max(coach.calorieFloor, targets.calories + coach.calorieAdvice!.delta), lastCalorieAdjust: formatLocalDate(new Date()) })}
                className="flex items-center justify-between gap-2 text-left rounded-lg border border-accent-200 bg-cream-50 px-2.5 py-1.5 min-h-[36px] hover:bg-accent-50 transition-colors">
                <span className="text-ink-600">
                  <strong className="text-accent-700">{coach.calorieAdvice.delta > 0 ? '+' : ''}{coach.calorieAdvice.delta} kcal</strong>
                  <span className="text-ink-400"> · {coach.calorieAdvice.reason}</span>
                </span>
                <span className="text-accent-600 font-semibold shrink-0">Apply</span>
              </button>
            ) : coach.onTrack ? (
              <p className="text-green-600">✓ {coach.onTrack}</p>
            ) : coach.atFloor ? (
              <p className="text-ink-500">At your calorie floor (~{coach.calorieFloor}) but not losing — take a diet break rather than cutting lower.</p>
            ) : !coach.consistent ? (
              <p className="text-ink-400">Logged {coach.loggedDays7}/7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock the calorie nudge.</p>
            ) : !coach.weighInsOk ? (
              <p className="text-ink-400">Weigh in more often ({coach.weighIns} readings) — a couple of weeks of regular weigh-ins lets me read your trend.</p>
            ) : coach.inCooldown ? (
              <p className="text-ink-400">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
            ) : null}
            {/* Protein suggestion (applyable) or on-target confirmation */}
            {coach.proteinForGoal != null && coach.proteinForGoal !== targets.protein ? (
              <button
                onClick={() => update({ protein: coach.proteinForGoal! })}
                className="flex items-center justify-between gap-2 text-left rounded-lg border border-accent-200 bg-cream-50 px-2.5 py-1.5 min-h-[36px] hover:bg-accent-50 transition-colors">
                <span className="text-ink-600">Suggested <strong className="text-accent-700">{coach.proteinForGoal}g</strong> protein <span className="text-ink-400">· {(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg × {Math.round(coach.weightKg)}kg</span></span>
                <span className="text-accent-600 font-semibold shrink-0">Apply</span>
              </button>
            ) : coach.proteinForGoal != null ? (
              <p className="text-green-600">✓ Protein target on point ({(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg)</p>
            ) : null}
            {coach.proteinPerMealG != null && (
              <p className="text-ink-400">💪 ≈{coach.proteinPerMealG}g protein per meal spreads it best{coach.fatFloorG != null ? ` · keep fat ≥ ~${coach.fatFloorG}g/day on a cut` : ''}</p>
            )}
          </>
        )}
      </div>

      {/* Slots — each a section of named dish rows. 2 columns on 2xl monitors
          to fill the extra width instead of a lone tall column. */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2.5">
        {SLOTS.map(({ slot, label, icon }) => {
          const meals = bySlot.get(slot) ?? []
          // Slot total = EATEN (diary) only, matching the ring; planned rows are
          // intent, shown as muted ghosts that don't add to the eaten total.
          const kcal = meals.filter(m => m.source === 'log').reduce((a, m) => a + m.calories, 0)
          return (
            <div key={slot} className="rounded-2xl border border-ink-200 bg-cream-50 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-100">
                <span className="text-base leading-none">{icon}</span>
                <span className="text-sm font-semibold text-ink-800 flex-1">{label}</span>
                {kcal > 0 && <span className="text-xs text-ink-400 tabular-nums">{kcal} kcal</span>}
                <button onClick={() => setLogSlot(slot)}
                  className="text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[32px] px-2 rounded-lg transition-colors">+ Log</button>
              </div>
              {meals.length > 0 ? (
                <ul className="divide-y divide-ink-50">
                  {meals.map(meal => {
                    const planned = meal.source === 'plan'
                    return (
                      <li key={meal.id} className="flex items-center gap-2 px-4 py-1 min-h-[40px] text-sm">
                        {/* Tap the row to edit it in place (eaten → diary edit;
                            planned → the meal-plan editor). */}
                        <button
                          type="button"
                          onClick={() => planned ? setPlanMeal(meal.planEntry ?? null) : setEditMeal(meal)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left min-h-[40px] hover:text-accent-700 transition-colors">
                          <span className={`flex-1 min-w-0 truncate ${planned ? 'text-ink-400 italic' : 'text-ink-800'}`}>{meal.title}</span>
                          {planned && <span className="text-[9px] uppercase tracking-wide text-ink-300 border border-ink-200 rounded px-1 shrink-0">planned</span>}
                          {meal.protein_g > 0 && <span className="text-[11px] text-ink-400 tabular-nums shrink-0">{meal.protein_g}p</span>}
                          {meal.calories > 0 && <span className={`text-xs tabular-nums shrink-0 w-16 text-right ${planned ? 'text-ink-300' : 'text-ink-500'}`}>{meal.calories} kcal</span>}
                        </button>
                        <button
                          onClick={() => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)}
                          aria-label={`Remove ${meal.title}`}
                          className="min-w-[28px] min-h-[28px] text-ink-300 hover:text-red-500 shrink-0">✕</button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <button onClick={() => setLogSlot(slot)}
                  className="w-full text-left px-4 py-2.5 text-xs text-ink-300 hover:text-accent-600 transition-colors">+ Add something</button>
              )}
            </div>
          )
        })}
      </div>

      {logSlot && (
        <FoodLogModal open onClose={() => setLogSlot(null)} date={date} defaultSlot={logSlot} />
      )}
      {editMeal && (
        <EditFoodLogModal meal={editMeal} date={date} onClose={() => setEditMeal(null)} />
      )}
      {planMeal && (
        <AssignMealModal open onClose={() => setPlanMeal(null)} date={date} mealSlot={planMeal.meal_slot} existing={planMeal} />
      )}
    </div>
  )
}
