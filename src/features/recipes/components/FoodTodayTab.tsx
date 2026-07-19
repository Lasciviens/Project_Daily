import { useState } from 'react'
import { format } from 'date-fns'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useNutritionCoach } from '../../daily/hooks/useNutritionCoach'
import { useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useDeleteQuickMeal } from '../../daily/hooks/useQuickMeals'
import { MacroBar } from './MacroBar'
import { FoodLogModal } from './FoodLogModal'
import { DateNav } from '../../../shared/components/DateNav'
import { formatLocalDate, shiftDateStr } from '../../../shared/utils/dateUtils'
import type { MealSlot } from '../types'
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
  const { targets } = useDayTargets()
  const coach = useNutritionCoach(date, targets)
  const delLog  = useDeleteFoodLogEntry()
  const delMeal = useDeleteQuickMeal()
  const [logSlot, setLogSlot] = useState<MealSlot | null>(null)

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinPct = targets.protein > 0 ? Math.min(Math.round((protein / targets.protein) * 100), 100) : 0
  const proteinLeft = Math.round(targets.protein - protein)
  const kcalLeft = Math.round(targets.calories - consumed)

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []; arr.push(m); bySlot.set(m.meal_slot, arr)
  }

  const d = new Date(date + 'T00:00:00')
  const isToday = date === formatLocalDate(new Date())

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      {/* Date nav */}
      <DateNav
        label={isToday ? 'Today' : format(d, 'EEE, d MMM')}
        labelClassName="text-sm font-bold text-ink-900 min-w-[110px] text-center"
        onPrev={() => setDate(s => shiftDateStr(s, -1))}
        onNext={() => setDate(s => shiftDateStr(s, 1))}
        onToday={() => setDate(formatLocalDate(new Date()))}
        isToday={isToday}
      />

      {/* Hero — ring + macros + remaining (the Nutrition card, full size) */}
      <div className="rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden">
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
              <div className="mt-3"><MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} /></div>
            )}
            <p className="text-[11px] text-ink-400 mt-2.5 tabular-nums">
              <span className={proteinLeft < 0 ? 'text-red-500' : 'text-ink-600'}>{proteinLeft >= 0 ? `${proteinLeft}g protein left` : `${-proteinLeft}g over`}</span>
              <span className="text-ink-300"> · </span>
              <span className={kcalLeft < 0 ? 'text-red-500' : 'text-ink-600'}>{kcalLeft >= 0 ? `${kcalLeft} kcal left` : `${-kcalLeft} over`}</span>
              {coach.weightKg != null && coach.proteinForGoal != null && (
                <span className="text-ink-300"> · target {coach.proteinForGoal}g ({targets.goal})</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Slots — each a section of named dish rows */}
      <div className="flex flex-col gap-2.5">
        {SLOTS.map(({ slot, label, icon }) => {
          const meals = bySlot.get(slot) ?? []
          const kcal = meals.reduce((a, m) => a + m.calories, 0)
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
                  {meals.map(meal => (
                    <li key={meal.id} className="flex items-center gap-2 px-4 py-2 min-h-[40px] text-sm">
                      <span className="text-ink-800 flex-1 min-w-0 truncate">{meal.title}</span>
                      {meal.protein_g > 0 && <span className="text-[11px] text-ink-400 tabular-nums shrink-0">{meal.protein_g}p</span>}
                      {meal.calories > 0 && <span className="text-xs text-ink-500 tabular-nums shrink-0 w-16 text-right">{meal.calories} kcal</span>}
                      <button
                        onClick={() => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)}
                        aria-label={`Remove ${meal.title}`}
                        className="min-w-[28px] min-h-[28px] text-ink-300 hover:text-red-500 shrink-0">✕</button>
                    </li>
                  ))}
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
    </div>
  )
}
