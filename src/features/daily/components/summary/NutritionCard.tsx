import { useState } from 'react'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useRecentMeals, useSetQuickMeal, useDeleteQuickMeal, useCopyYesterdayMeals } from '../../hooks/useQuickMeals'
import { MacroBar } from '../../../recipes/components/MacroBar'
import { AssignMealModal } from '../../../recipes/components/AssignMealModal'
import type { MealSlot } from '../../../recipes/types'

const SLOTS: { slot: MealSlot; label: string }[] = [
  { slot: 'breakfast', label: 'Breakfast' },
  { slot: 'lunch',     label: 'Lunch' },
  { slot: 'dinner',    label: 'Dinner' },
  { slot: 'snack',     label: 'Snack' },
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
// recent-meal chips. The whole point is adding a meal in 1-2 taps without
// leaving Daily (the old card was read-only and linked out to /recipes).
function SlotRow({ date, slot, label, meal }: {
  date: string; slot: MealSlot; label: string
  meal?: { id: string; title: string; calories: number }
}) {
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState(false)
  const [text, setText] = useState('')
  const { data: recent = [] } = useRecentMeals()
  const setMeal = useSetQuickMeal()
  const delMeal = useDeleteQuickMeal()

  function save(title: string, recipeId?: string | null) {
    if (!title.trim()) return
    setMeal.mutate({ date, slot, title: title.trim(), recipeId }, { onSuccess: () => { setAdding(false); setText('') } })
  }

  return (
    <li className="text-xs min-h-[28px]">
      {meal ? (
        <div className="flex items-center gap-2 min-h-[28px]">
          <span className="text-ink-400 w-16 shrink-0">{label}</span>
          <span className="text-ink-700 flex-1 truncate">{meal.title}</span>
          {meal.calories > 0 && <span className="text-ink-400 shrink-0">{meal.calories} kcal</span>}
          <button
            onClick={() => setDetail(true)}
            className="text-ink-300 hover:text-accent-600 min-w-[24px] min-h-[28px] flex items-center justify-center shrink-0"
            title="Edit in detail (recipe/ingredient/servings)"
          >✎</button>
          <button
            onClick={() => delMeal.mutate(meal.id)}
            className="text-ink-300 hover:text-red-500 min-w-[24px] min-h-[28px] flex items-center justify-center shrink-0"
            aria-label={`Remove ${label}`}
          >✕</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-ink-400 w-16 shrink-0">{label}</span>
            {adding ? (
              <input
                autoFocus value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(text); if (e.key === 'Escape') setAdding(false) }}
                onBlur={() => { if (!text.trim()) setAdding(false) }}
                placeholder="What did/will you eat?"
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
                onClick={() => { setAdding(false); setDetail(true) }}
                className="text-ink-300 hover:text-accent-600 min-w-[24px] min-h-[28px] shrink-0"
                title="Detailed entry (recipe / ingredient / servings)"
              >⋯</button>
            )}
          </div>
          {adding && recent.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 pl-[4.5rem]">
              {recent.slice(0, 5).map(r => (
                <button key={r.title} onClick={() => save(r.title, r.recipeId)}
                  className="px-2 py-0.5 rounded-full border border-ink-200 text-[10px] text-ink-600 hover:border-accent-300 min-h-[24px]">
                  {r.title}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {/* Detailed manual entry — the SAME full modal Recipes' meal planner
          uses (recipe picker / library ingredient / servings / notes), so the
          "detailed" path exists on Daily too, not just the fast path. */}
      {detail && (
        <AssignMealModal open onClose={() => setDetail(false)} date={date} mealSlot={slot} />
      )}
    </li>
  )
}

export function NutritionCard({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const [editing, setEditing] = useState(false)
  const copyYesterday = useCopyYesterdayMeals()

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinPct = targets.protein > 0 ? Math.min(Math.round((protein / targets.protein) * 100), 100) : 0
  const mealsBySlot = new Map((nut?.meals ?? []).map(m => [m.meal_slot, m]))
  const filledSlots = new Set(mealsBySlot.keys())

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-800 flex items-center gap-1.5">🍽️ Nutrition</h3>
        <div className="flex items-center gap-1">
          {filledSlots.size < SLOTS.length && (
            <button
              onClick={() => copyYesterday.mutate({ date, filledSlots })}
              disabled={copyYesterday.isPending}
              className="text-[11px] text-ink-400 hover:text-accent-600 min-h-[28px] px-1.5 rounded transition-colors disabled:opacity-50"
              title="Copy yesterday's meals into empty slots"
            >⧉ Yesterday</button>
          )}
          <button onClick={() => setEditing(e => !e)}
            className="text-[11px] text-ink-400 hover:text-ink-700 min-h-[28px] px-1.5 rounded transition-colors">
            {editing ? 'Done' : 'Goals'}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-2 text-xs text-ink-600">
            Calorie goal
            <input type="number" value={targets.calories} min={0}
              onChange={e => update({ calories: Number(e.target.value) || 0 })}
              className="input w-24 text-sm py-1 text-right" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-ink-600">
            Protein goal (g)
            <input type="number" value={targets.protein} min={0}
              onChange={e => update({ protein: Number(e.target.value) || 0 })}
              className="input w-24 text-sm py-1 text-right" />
          </label>
        </div>
      ) : (
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
              </div>
              {(nut && nut.calories > 0) && (
                <div className="mt-2">
                  <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} />
                </div>
              )}
            </div>
          </div>

          <ul className="flex flex-col gap-0.5 pt-1 border-t border-ink-100">
            {SLOTS.map(({ slot, label }) => (
              <SlotRow key={slot} date={date} slot={slot} label={label} meal={mealsBySlot.get(slot)} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
