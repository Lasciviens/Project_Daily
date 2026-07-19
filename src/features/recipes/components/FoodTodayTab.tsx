import { useState } from 'react'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets, type NutritionGoal } from '../../daily/hooks/useDayTargets'
import { useNutritionCoach } from '../../daily/hooks/useNutritionCoach'
import { useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useDeleteQuickMeal } from '../../daily/hooks/useQuickMeals'
import { useEatPlannedEntry } from '../hooks/useMealPlan'
import { MacroBar } from './MacroBar'
import { FoodLogModal } from './FoodLogModal'
import { EditFoodLogModal } from './EditFoodLogModal'
import { AssignMealModal } from './AssignMealModal'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import type { MealSlot, MealPlanEntry } from '../types'
import type { DayMeal } from '../../daily/api/dayNutritionApi'

// ─────────────────────────────────────────────────────────────────────────────
//  Food · Today — the FULL-SIZE nutrition surface. Two columns on wide screens
//  (summary + coach left · meal slots right, so the right isn't empty). Small
//  calorie + protein rings, macro chips (fiber inline w/ a green dot next to
//  fat), an inline Goals editor, and — the key flow — a ✓ on a PLANNED row
//  confirms it as EATEN so it starts counting toward the day.
// ─────────────────────────────────────────────────────────────────────────────

const SLOTS: { slot: MealSlot; label: string; icon: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast',  icon: '🌅' },
  { slot: 'lunch',      label: 'Lunch',      icon: '☀️' },
  { slot: 'dinner',     label: 'Dinner',     icon: '🌙' },
  { slot: 'snack',      label: 'Snack',      icon: '🍎' },
  { slot: 'supplement', label: 'Supplement', icon: '💊' },
]
const GOAL_LABEL: Record<NutritionGoal, string> = { maintain: 'Maintain', cut: 'Cut', gain: 'Gain' }

function Ring({ consumed, target, size, stroke, color, label }: {
  consumed: number; target: number; size: number; stroke: number; color: string; label: string
}) {
  const R = (size - stroke) / 2 - 1
  const C = 2 * Math.PI * R
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0
  const remaining = Math.max(Math.round(target - consumed), 0)
  const over = consumed > target
  const cx = size / 2
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={cx} cy={cx} r={R} fill="none" stroke="rgb(var(--ink-100))" strokeWidth={stroke} />
        <circle cx={cx} cy={cx} r={R} fill="none" stroke={over ? '#f87171' : color}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold text-ink-900 leading-none tabular-nums ${size > 100 ? 'text-2xl' : 'text-base'}`}>{remaining}</span>
        <span className="text-[9px] text-ink-400 mt-0.5">{over ? 'over' : label}</span>
      </div>
    </div>
  )
}

// −/+ stepper for a goal number (same feel as the Daily card's).
function GoalStepper({ value, step, suffix, onChange }: { value: number; step: number; suffix: string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, v))
  const btn = 'w-8 h-8 min-h-[32px] rounded-lg border border-ink-200 text-ink-600 hover:border-accent-300 flex items-center justify-center leading-none'
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => set(value - step)} className={btn}>−</button>
      <div className="relative">
        <input type="number" value={value} min={0} step={step} onChange={e => set(Number(e.target.value) || 0)}
          className="w-20 min-h-[32px] text-sm text-center pr-8 tabular-nums border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-400 pointer-events-none">{suffix}</span>
      </div>
      <button type="button" onClick={() => set(value + step)} className={btn}>+</button>
    </div>
  )
}

export function FoodTodayTab({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const coach = useNutritionCoach(date, targets)
  const delLog  = useDeleteFoodLogEntry()
  const delMeal = useDeleteQuickMeal()
  const eatPlan = useEatPlannedEntry()
  const [logSlot, setLogSlot] = useState<MealSlot | null>(null)
  const [editMeal, setEditMeal] = useState<DayMeal | null>(null)
  const [planMeal, setPlanMeal] = useState<MealPlanEntry | null>(null)
  const [goalsOpen, setGoalsOpen] = useState(false)

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinLeft = Math.round(targets.protein - protein)
  const proteinHit  = targets.protein > 0 && proteinLeft <= 0

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []; arr.push(m); bySlot.set(m.meal_slot, arr)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Day navigation now lives in the header banner (RecipesPage). */}

      {/* Two columns on xl+: summary+goals+coach (left, wider) · meal slots
          (right, narrower). Nutrition & Goals stack same-width in the left col. */}
      <div className="flex flex-col xl:flex-row xl:items-start gap-4">
        <div className="flex flex-col gap-4 w-full xl:w-[34rem] xl:shrink-0">
          {/* Hero — calorie + protein rings + macro chips */}
          <div className="rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden relative">
            <div className="h-1 bg-accent-500" />
            {/* ⚙ Goals — bottom-right corner of the nutrition widget. */}
            <button onClick={() => setGoalsOpen(o => !o)} title="Goals" aria-label="Goals"
              className={`press-feedback absolute bottom-2 right-2 min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-base transition-colors ${goalsOpen ? 'text-accent-700 bg-accent-50' : 'text-ink-400 hover:text-accent-600 hover:bg-cream-100/90 bg-cream-50/70'}`}>⚙</button>
            <div className="p-6 flex items-center gap-5 flex-wrap">
              <Ring consumed={consumed} target={targets.calories} size={134} stroke={11} color="rgb(var(--accent-500))" label="kcal left" />
              {/* Small, tasteful protein ring — "kalan protein" as a graphic. */}
              <Ring consumed={protein} target={targets.protein} size={92} stroke={9} color="#60a5fa" label="prot left" />
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm text-ink-700">
                  <strong className="text-lg text-ink-900 tabular-nums">{consumed}</strong>
                  <span className="text-ink-400"> / {targets.calories} kcal</span>
                </p>
                <p className="text-[11px] mt-0.5 tabular-nums">
                  {proteinHit
                    ? <span className="text-green-600 font-medium">✓ Protein hit{proteinLeft < 0 ? ` (+${-proteinLeft}g)` : ''}</span>
                    : <span className="text-ink-500"><strong className="text-ink-700">{protein}g</strong> / {targets.protein}g protein · {proteinLeft}g left</span>}
                </p>
                {nut && nut.calories > 0 && (
                  <div className="mt-2.5">
                    <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                    {/* P · C · F · Fiber — the four side by side (fiber green). */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 pr-10 text-[11px] tabular-nums">
                      <span className="text-ink-600">{nut.protein_g}g <span className="text-ink-400">P</span></span>
                      <span className="text-ink-600">{nut.carbs_g}g <span className="text-ink-400">C</span></span>
                      <span className="text-ink-600">{nut.fat_g}g <span className="text-ink-400">F</span></span>
                      <span className="text-ink-600">{nut.fiber_g}g <span className="text-ink-400">fiber</span></span>
                      {nut.sugar_g > 0 && <span className="text-ink-500">{nut.sugar_g}g <span className="text-ink-400">sugar</span></span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Goals editor — under the nutrition widget, same width (user
              request). Set targets by hand + apply coach suggestions. */}
          {goalsOpen && (
            <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Goal</span>
                <div className="flex gap-1">
                  {(['maintain', 'cut', 'gain'] as NutritionGoal[]).map(g => (
                    <button key={g} onClick={() => update({ goal: g })}
                      className={`text-[11px] px-2.5 min-h-[32px] rounded-full border transition-colors ${
                        targets.goal === g ? 'bg-accent-500 border-accent-500 text-white font-semibold' : 'border-ink-200 text-ink-600 hover:border-accent-300'
                      }`}>{GOAL_LABEL[g]}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Calories</span>
                <GoalStepper value={targets.calories} step={50} suffix="kcal" onChange={v => update({ calories: v })} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Protein</span>
                <GoalStepper value={targets.protein} step={10} suffix="g" onChange={v => update({ protein: v })} />
              </div>
              <p className="text-[11px] text-ink-400 leading-relaxed">
                These are YOUR targets (saved on this device). The 🧠 Coach suggests a protein target from your bodyweight
                ({coach.weightKg ? `~${coach.proteinForGoal}g for ${targets.goal}` : 'add a bodyweight to enable'}) and nudges
                calories from your 4-week weight trend — apply those from the Coach card below. Fiber goal ≈ 14g per 1000 kcal.
              </p>
            </div>
          )}

          {/* Coach — always visible so it's discoverable. */}
          <div className="rounded-2xl border border-accent-200 bg-accent-50/40 px-4 py-3 flex flex-col gap-1.5 text-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-700">🧠 Coach</p>
            {coach.weightKg == null ? (
              <p className="text-ink-500">Add a bodyweight in <strong className="text-ink-700">Training → Body</strong> (or sync Apple Health) to unlock protein &amp; calorie coaching from your real weight trend.</p>
            ) : (
              <>
                {coach.calorieAdvice ? (
                  <button
                    onClick={() => update({ calories: Math.max(coach.calorieFloor, targets.calories + coach.calorieAdvice!.delta), lastCalorieAdjust: formatLocalDate(new Date()) })}
                    className="flex items-center justify-between gap-2 text-left rounded-lg border border-accent-200 bg-cream-50 px-2.5 py-1.5 min-h-[36px] hover:bg-accent-50 transition-colors">
                    <span className="text-ink-600"><strong className="text-accent-700">{coach.calorieAdvice.delta > 0 ? '+' : ''}{coach.calorieAdvice.delta} kcal</strong><span className="text-ink-400"> · {coach.calorieAdvice.reason}</span></span>
                    <span className="text-accent-600 font-semibold shrink-0">Apply</span>
                  </button>
                ) : coach.onTrack ? (
                  <p className="text-green-600">✓ {coach.onTrack}</p>
                ) : coach.atFloor ? (
                  <p className="text-ink-500">At your calorie floor (~{coach.calorieFloor}) but not losing — take a diet break rather than cutting lower.</p>
                ) : !coach.consistent ? (
                  <p className="text-ink-400">Logged {coach.loggedDays7}/7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock the calorie nudge.</p>
                ) : !coach.weighInsOk ? (
                  <p className="text-ink-400">Weigh in more often ({coach.weighIns} readings) — a couple of weeks lets me read your trend.</p>
                ) : coach.inCooldown ? (
                  <p className="text-ink-400">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
                ) : null}
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
        </div>

        {/* Meal slots — fill the right column on wide screens. Cascade in on mobile. */}
        <div className="flex-1 min-w-0 grid grid-cols-1 2xl:grid-cols-2 gap-2.5 content-start stagger-in">
          {SLOTS.map(({ slot, label, icon }) => {
            const meals = bySlot.get(slot) ?? []
            const kcal = meals.filter(m => m.source === 'log').reduce((a, m) => a + m.calories, 0)
            return (
              <div key={slot} className="rounded-2xl border border-ink-200 bg-cream-50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-100">
                  <span className="text-base leading-none">{icon}</span>
                  <span className="text-sm font-semibold text-ink-800 flex-1">{label}</span>
                  {kcal > 0 && <span className="text-xs text-ink-400 tabular-nums">{kcal} kcal</span>}
                  <button onClick={() => setLogSlot(slot)}
                    className="press-feedback text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[40px] px-2.5 rounded-lg transition-colors">+ Log</button>
                </div>
                {meals.length > 0 ? (
                  <ul className="divide-y divide-ink-50">
                    {meals.map(meal => {
                      const planned = meal.source === 'plan'
                      return (
                        <li key={meal.id} className="flex items-center gap-1.5 px-4 py-1 min-h-[40px] text-sm">
                          <button
                            type="button"
                            onClick={() => planned ? setPlanMeal(meal.planEntry ?? null) : setEditMeal(meal)}
                            className="flex items-center gap-2 flex-1 min-w-0 text-left min-h-[40px] hover:text-accent-700 transition-colors">
                            <span className={`flex-1 min-w-0 truncate ${planned ? 'text-ink-400 italic' : 'text-ink-800'}`}>{meal.title}</span>
                            {planned && <span className="text-[9px] uppercase tracking-wide text-ink-300 border border-ink-200 rounded px-1 shrink-0">planned</span>}
                            {meal.protein_g > 0 && <span className="text-[11px] text-ink-400 tabular-nums shrink-0">{meal.protein_g}p</span>}
                            {meal.calories > 0 && <span className={`text-xs tabular-nums shrink-0 w-14 text-right ${planned ? 'text-ink-300' : 'text-ink-500'}`}>{meal.calories}</span>}
                          </button>
                          {/* Planned → confirm as eaten (starts counting). */}
                          {planned && meal.planEntry && (
                            <button
                              onClick={() => eatPlan.mutate(meal.planEntry!)}
                              disabled={eatPlan.isPending}
                              aria-label={`Mark ${meal.title} eaten`} title="I ate this — count it"
                              className="press-feedback min-w-[40px] min-h-[40px] rounded-full text-green-600 hover:bg-green-50 shrink-0 disabled:opacity-50">✓</button>
                          )}
                          <button
                            onClick={() => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)}
                            aria-label={`Remove ${meal.title}`}
                            className="press-feedback min-w-[40px] min-h-[40px] flex items-center justify-center text-ink-300 hover:text-red-500 shrink-0">✕</button>
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
      </div>

      {logSlot && <FoodLogModal open onClose={() => setLogSlot(null)} date={date} defaultSlot={logSlot} />}
      {editMeal && <EditFoodLogModal meal={editMeal} date={date} onClose={() => setEditMeal(null)} />}
      {planMeal && <AssignMealModal open onClose={() => setPlanMeal(null)} date={date} mealSlot={planMeal.meal_slot} existing={planMeal} />}
    </div>
  )
}
