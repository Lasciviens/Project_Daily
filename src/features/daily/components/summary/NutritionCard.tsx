import { todayStr } from '../../../../shared/utils/dateUtils'
import { useState } from 'react'
import { useEatPlannedEntry } from '../../../recipes/hooks/useMealPlan'
import { Cell, CellHeader } from './cellKit'
import { WaterTracker } from './WaterTracker'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets, type NutritionGoal } from '../../hooks/useDayTargets'
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

const SLOTS: { slot: MealSlot; label: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast' },
  { slot: 'lunch',      label: 'Lunch' },
  { slot: 'dinner',     label: 'Dinner' },
  { slot: 'snack',      label: 'Snack' },
  { slot: 'supplement', label: 'Suppl.' },
]

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
        <span className="text-[9px] text-ink-400 mt-0.5">{over ? 'over' : 'left'}</span>
      </div>
    </div>
  )
}

// One slot row: filled → title + kcal + remove; empty → inline quick-add with
// recent-food chips. Every fast-path add now writes a REAL-macro diary row
// (food_log_entries), not a macro-less plan title — a recent chip re-logs its
// own snapshot; free text that matches your library logs that ingredient;
// anything else opens the full logger prefilled (so it still gets macros).
function SlotRow({ date, slot, label, meals }: {
  date: string; slot: MealSlot; label: string
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
    <li className="text-xs min-h-[28px]">
      {meals.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {meals.map((meal, i) => (
            <div key={meal.id} className="flex items-center gap-2 min-h-[28px]">
              <span className="text-ink-400 w-16 shrink-0">{i === 0 ? label : ''}</span>
              <span className="text-ink-700 flex-1 truncate">{meal.title}</span>
              {meal.calories > 0 && <span className="text-ink-400 shrink-0">{meal.calories} kcal</span>}
              {meal.source === 'plan' && meal.planEntry && (
                <button onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
                  title="I ate this — count it" aria-label="Mark eaten"
                  className="text-green-600 hover:bg-green-50 rounded-full min-w-[24px] min-h-[28px] flex items-center justify-center shrink-0 disabled:opacity-50">✓</button>
              )}
              <button
                onClick={() => meal.source === 'plan' ? setEditPlan(meal.planEntry!) : setEditLog(meal)}
                className="text-ink-300 hover:text-accent-600 min-w-[24px] min-h-[28px] flex items-center justify-center shrink-0"
                title={meal.source === 'plan' ? 'Edit planned meal' : 'Edit logged food (amount / macros)'}
              >✎</button>
              <button
                onClick={() => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)}
                className="text-ink-300 hover:text-red-500 min-w-[24px] min-h-[28px] flex items-center justify-center shrink-0"
                aria-label={`Remove ${meal.title}`}
              >✕</button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-ink-400 w-16 shrink-0">{label}</span>
            {adding ? (
              <input
                autoFocus value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(text); if (e.key === 'Escape') reset() }}
                onBlur={() => { if (!text.trim()) reset() }}
                placeholder="Type a food…"
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-accent-300 bg-cream-50 focus:outline-none focus:ring-1 focus:ring-accent-400 min-h-[28px]"
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex-1 text-left text-ink-300 hover:text-accent-600 transition-colors min-h-[28px]"
              >+ add</button>
            )}
            {adding && (
              <button
                onClick={() => { setLogQuery(text.trim()); setLogOpen(true); reset() }}
                className="text-ink-300 hover:text-accent-600 min-w-[24px] min-h-[28px] shrink-0"
                title="Build a meal (pick ingredients, grams, macros)"
              >⋯</button>
            )}
          </div>
          {adding && recent.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 pl-[4.5rem]">
              {recent.slice(0, 5).map(r => (
                <button key={r.key} onClick={() => reLog(r)}
                  className="px-2 py-0.5 rounded-full border border-ink-200 text-[10px] text-ink-600 hover:border-accent-300 min-h-[24px]">
                  {r.title}{r.protein_g != null && r.protein_g > 0 && <span className="text-ink-400"> · {Math.round(r.protein_g)}p</span>}
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

// −/+ stepper for the calorie/protein goals — the goals move in meaningful
// increments (kcal by 50, protein by 10) instead of the native number
// spinner's ±1, which is tedious for values in the hundreds. The field stays
// directly typeable too; the step attribute makes keyboard ↑/↓ match the
// buttons. Clamped at 0.
function GoalStepper({ value, step, onChange, suffix }: {
  value: number; step: number; onChange: (v: number) => void; suffix: string
}) {
  const set = (v: number) => onChange(Math.max(0, v))
  const btn = 'w-9 h-9 min-h-[36px] rounded-lg border border-ink-200 text-ink-600 hover:border-accent-300 hover:text-accent-600 flex items-center justify-center text-lg leading-none transition-colors select-none'
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`−${step}`} onClick={() => set(value - step)} className={btn}>−</button>
      <div className="relative">
        <input
          type="number" value={value} min={0} step={step}
          onChange={e => set(Number(e.target.value) || 0)}
          className="input w-24 text-sm py-1 text-center pr-9 tabular-nums"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-400 pointer-events-none">{suffix}</span>
      </div>
      <button type="button" aria-label={`+${step}`} onClick={() => set(value + step)} className={btn}>+</button>
    </div>
  )
}

const GOAL_LABEL: Record<NutritionGoal, string> = { maintain: 'Maintain', cut: 'Cut', gain: 'Gain' }

export function NutritionCard({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const coach = useNutritionCoach(date, targets)
  const [editing, setEditing] = useState(false)
  const copyYesterday = useCopyYesterdayMeals()

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

  return (
    <Cell>
      <CellHeader
        icon="🍽️" title="Nutrition"
        action={
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => setLogOpen(true)}
              className="text-[11px] font-semibold text-accent-600 hover:text-accent-700 min-h-[28px] px-1.5 rounded transition-colors"
              title="Log food — pick ingredients from your library, grams, done">
              + Log
            </button>
          </div>
        }
      />

      {/* Hydration — always visible (independent of meals), consistent per day. */}
      {!editing && (
        <div className="pb-1 mb-1 border-b border-ink-100">
          <WaterTracker date={date} />
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          {/* Goal — steers the protein g/kg suggestion + calorie coaching */}
          <div className="flex items-center justify-between gap-2 text-xs text-ink-600">
            <span>Goal</span>
            <div className="flex gap-1">
              {(['maintain', 'cut', 'gain'] as NutritionGoal[]).map(g => (
                <button key={g} onClick={() => update({ goal: g })}
                  className={`text-[11px] px-2 min-h-[28px] rounded-full border transition-colors ${
                    targets.goal === g ? 'bg-accent-500 border-accent-500 text-white font-semibold' : 'border-ink-200 text-ink-600 hover:border-accent-300'
                  }`}>{GOAL_LABEL[g]}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-ink-600">
            <span>Calorie goal</span>
            <GoalStepper value={targets.calories} step={50} onChange={v => update({ calories: v })} suffix="kcal" />
          </div>
          {/* Safety floor — a target below RMR-protecting intake is flagged, not silently allowed */}
          {targets.calories < coach.calorieFloor && (
            <p className="text-[10px] text-red-500 px-0.5 -mt-1">⚠ Below a safe floor (~{coach.calorieFloor} kcal). Don't cut lower — take a diet break instead.</p>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-ink-600">
            <span>Protein goal</span>
            <GoalStepper value={targets.protein} step={10} onChange={v => update({ protein: v })} suffix="g" />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-ink-600">
            <span>Water goal</span>
            <GoalStepper value={targets.water} step={250} onChange={v => update({ water: v })} suffix="ml" />
          </div>

          {/* Bodyweight-based protein suggestion (real latest weight) */}
          {coach.weightKg == null ? (
            <p className="text-[10px] text-ink-400 px-0.5">Sync or add a bodyweight (Training → Body) to get protein &amp; calorie suggestions.</p>
          ) : coach.proteinForGoal != null && coach.proteinForGoal !== targets.protein ? (
            <button onClick={() => update({ protein: coach.proteinForGoal! })}
              className="flex items-center justify-between gap-2 text-[11px] text-left rounded-lg border border-accent-200 bg-accent-50/50 px-2.5 py-1.5 min-h-[36px] hover:bg-accent-50 transition-colors">
              <span className="text-ink-600">
                Suggested <strong className="text-accent-700">{coach.proteinForGoal}g</strong> protein
                <span className="text-ink-400"> · {(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg × {Math.round(coach.weightKg)}kg</span>
              </span>
              <span className="text-accent-600 font-semibold shrink-0">Apply</span>
            </button>
          ) : coach.proteinForGoal != null ? (
            <p className="text-[10px] text-ink-400 px-0.5">✓ Protein on target ({(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg).</p>
          ) : null}

          {/* Fat floor — only on a cut (hormonal-health minimum) */}
          {coach.fatFloorG != null && (
            <p className="text-[10px] text-ink-400 px-0.5">Keep fat ≥ ~{coach.fatFloorG}g/day on a cut (hormonal health).</p>
          )}

          {/* Adaptive calorie coaching — gated on intake logging AND weight-signal
              quality AND a cooldown; shows an honest 'on track' / floor / gate state */}
          {coach.weightKg != null && (
            coach.calorieAdvice ? (
              <button onClick={() => update({ calories: Math.max(coach.calorieFloor, targets.calories + coach.calorieAdvice!.delta), lastCalorieAdjust: todayStr() })}
                className="flex items-center justify-between gap-2 text-[11px] text-left rounded-lg border border-accent-200 bg-accent-50/50 px-2.5 py-1.5 min-h-[36px] hover:bg-accent-50 transition-colors">
                <span className="text-ink-600">
                  <strong className="text-accent-700">{coach.calorieAdvice.delta > 0 ? '+' : ''}{coach.calorieAdvice.delta} kcal</strong>
                  <span className="text-ink-400"> · {coach.calorieAdvice.reason}</span>
                </span>
                <span className="text-accent-600 font-semibold shrink-0">Apply</span>
              </button>
            ) : coach.onTrack ? (
              <p className="text-[10px] text-green-600 px-0.5">✓ {coach.onTrack}</p>
            ) : coach.atFloor ? (
              <p className="text-[10px] text-ink-500 px-0.5">You're at your calorie floor (~{coach.calorieFloor}) but not losing — take a diet break rather than cutting lower.</p>
            ) : coach.inCooldown ? (
              <p className="text-[10px] text-ink-400 px-0.5">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
            ) : !coach.consistent ? (
              <p className="text-[10px] text-ink-400 px-0.5">Logged {coach.loggedDays7} of the last 7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock calorie coaching.</p>
            ) : !coach.weighInsOk ? (
              <p className="text-[10px] text-ink-400 px-0.5">Weigh in more often ({coach.weighIns} readings) — a couple of weeks of regular weigh-ins lets me read your trend.</p>
            ) : null
          )}

          <button onClick={() => setEditing(false)}
            className="self-end text-[11px] font-medium text-ink-500 hover:text-ink-800 min-h-[28px] px-1.5 rounded transition-colors">
            Done
          </button>
        </div>
      ) : hasMeals || expanded ? (
        <>
          <div className="flex items-center gap-3">
            <CalorieRing consumed={consumed} target={targets.calories} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-700">
                <strong className="text-ink-900">{consumed}</strong>
                <span className="text-ink-400"> / {targets.calories} kcal</span>
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
                  <p className="text-[10px] text-ink-400 mt-1">≈{coach.proteinPerMealG}g protein per meal spreads it best</p>
                )}
              </div>
              {(nut && nut.calories > 0) && (
                <div className="mt-2">
                  <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                  {nut.fiber_g > 0 && (
                    <p className="text-[10px] text-ink-400 mt-1">🌾 Fiber {nut.fiber_g}g <span className="text-ink-300">/ ~{Math.round((targets.calories / 1000) * 14)}g goal</span></p>
                  )}
                </div>
              )}
            </div>
          </div>

          <ul className="flex flex-col gap-0.5 pt-1 border-t border-ink-100">
            {SLOTS.map(({ slot, label }) => (
              <SlotRow key={slot} date={date} slot={slot} label={label} meals={mealsBySlot.get(slot) ?? []} />
            ))}
          </ul>

          {/* Footer meta — secondary tools demoted out of the header */}
          <div className="flex items-center justify-end gap-1 border-t border-ink-100 pt-1.5 -mb-1">
            {filledSlots.size < SLOTS.length && (
              <button
                onClick={() => copyYesterday.mutate({ date, filledSlots })}
                disabled={copyYesterday.isPending}
                className="text-[10px] text-ink-400 hover:text-accent-600 min-h-[28px] px-1.5 rounded transition-colors disabled:opacity-50"
                title="Copy yesterday's meals into empty slots"
              >⧉ Yesterday</button>
            )}
            <button onClick={() => setEditing(true)}
              className="text-[10px] text-ink-400 hover:text-ink-700 min-h-[28px] px-1.5 rounded transition-colors">
              Goals
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1 py-0.5">
          <p className="text-xs text-ink-400">Nothing logged yet · goal {targets.calories} kcal / {targets.protein}g protein</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setExpanded(true)}
              className="text-xs text-ink-500 hover:text-accent-600 text-left min-h-[28px] transition-colors">
              Meal slots ▾
            </button>
            <button onClick={() => setEditing(true)}
              className="text-xs text-ink-400 hover:text-ink-700 min-h-[28px] transition-colors">
              Goals
            </button>
          </div>
        </div>
      )}
      {logOpen && <FoodLogModal open onClose={() => setLogOpen(false)} date={date} />}
    </Cell>
  )
}
