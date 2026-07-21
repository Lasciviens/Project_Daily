import { useMemo, useState } from 'react'
import { WEIGHT_UNITS } from '../api/recipesApi'
import { sanitizeDecimal } from './foodLogUtils'
import type { RecipeWithIngredients } from '../types'

// Portion picker for a saved meal — the "I made a 2-portion batch, I ate 50%"
// flow. Free % of the WHOLE meal; when the recipe's total weight is computable
// (all ingredients in g/ml) grams is offered too and kept in sync.
// servingsEaten = pct/100 × recipe.servings.
export function MealPortionPicker({ recipe, busy, onLog, onCancel }: {
  recipe: RecipeWithIngredients
  busy:   boolean
  onLog:  (servingsEaten: number) => void
  onCancel: () => void
}) {
  const totalG = useMemo(
    () => recipe.ingredients.reduce(
      (a, i) => a + (i.unit && WEIGHT_UNITS.has(i.unit.trim().toLowerCase()) && i.quantity ? i.quantity : 0),
      0,
    ),
    [recipe],
  )
  const [pct, setPct] = useState('100')
  const p = Math.max(0, Number(sanitizeDecimal(pct)) || 0)
  const servingsEaten = Math.round((p / 100) * recipe.servings * 100) / 100
  const kcal = Math.round((recipe.calories ?? 0) * servingsEaten)
  const prot = Math.round((recipe.protein_g ?? 0) * servingsEaten)
  const grams = totalG > 0 ? Math.round((p / 100) * totalG) : null

  return (
    <div className="rounded-2xl border border-accent-200 bg-accent-50/50 p-3.5 flex flex-col gap-2">
      <p className="text-xs font-semibold text-accent-700 truncate">How much of “{recipe.title}” did you eat?</p>
      <div className="flex gap-1.5 flex-wrap">
        {[25, 50, 75, 100].map(v => (
          <button key={v} type="button" onClick={() => setPct(String(v))}
            className={`text-xs px-3 min-h-[36px] rounded-full border transition-colors ${
              p === v ? 'border-accent-500 bg-accent-500 text-white' : 'border-accent-200 text-accent-700 hover:border-accent-400'
            }`}>
            {v}%
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <input value={pct} onChange={e => setPct(sanitizeDecimal(e.target.value))} inputMode="decimal"
            className="w-16 min-h-[40px] px-2 text-sm text-right border border-ink-200 rounded-xl bg-cream-50 tabular-nums" />
          <span className="text-[11px] text-ink-400">%</span>
        </div>
        {grams != null && (
          <div className="flex items-center gap-1">
            <span className="text-ink-300 text-xs">·</span>
            <input
              value={grams}
              onChange={e => {
                const g = Number(sanitizeDecimal(e.target.value)) || 0
                setPct(totalG > 0 ? String(Math.round((g / totalG) * 1000) / 10) : '0')
              }}
              inputMode="decimal"
              className="w-16 min-h-[40px] px-2 text-sm text-right border border-ink-200 rounded-xl bg-cream-50 tabular-nums" />
            <span className="text-[11px] text-ink-400">g</span>
          </div>
        )}
        <span className="text-[11px] text-ink-500 tabular-nums ml-auto">
          {servingsEaten}× · <strong className="text-ink-800">{kcal}</strong> kcal · {prot}g P
        </span>
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={onCancel} className="flex-1 min-h-[44px] text-xs text-ink-500 hover:bg-ink-100 rounded-xl">Cancel</button>
        <button type="button" onClick={() => onLog(servingsEaten)} disabled={busy || servingsEaten <= 0}
          className="flex-1 min-h-[44px] text-xs font-semibold bg-accent-500 text-white rounded-xl hover:bg-accent-600 disabled:opacity-50">
          {busy ? 'Logging…' : `Log ${p}%`}
        </button>
      </div>
    </div>
  )
}
