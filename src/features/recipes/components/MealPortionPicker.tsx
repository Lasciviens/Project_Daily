import { useMemo, useState } from 'react'
import { WEIGHT_UNITS } from '../api/recipesApi'
import { Button } from '../../../shared/ui'
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
    <div className="flex flex-col gap-2.5 rounded-card border border-accent-500/25 bg-accent-50 p-3.5">
      <p className="truncate text-meta font-semibold text-accent-700">How much of “{recipe.title}” did you eat?</p>
      <div className="flex flex-wrap gap-1.5">
        {[25, 50, 75, 100].map(v => (
          <button key={v} type="button" onClick={() => setPct(String(v))} aria-pressed={p === v} className="pill-tab border border-line bg-surface">
            {v}%
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <input value={pct} onChange={e => setPct(sanitizeDecimal(e.target.value))} inputMode="decimal" aria-label="Percent of the batch"
            className="input w-16 text-right tabular-nums" />
          <span className="text-meta text-fg-muted">%</span>
        </div>
        {grams != null && (
          <div className="flex items-center gap-1">
            <span className="text-meta text-fg-faint">·</span>
            <input
              value={grams}
              aria-label="Grams eaten"
              onChange={e => {
                const g = Number(sanitizeDecimal(e.target.value)) || 0
                setPct(totalG > 0 ? String(Math.round((g / totalG) * 1000) / 10) : '0')
              }}
              inputMode="decimal"
              className="input w-16 text-right tabular-nums" />
            <span className="text-meta text-fg-muted">g</span>
          </div>
        )}
        <span className="ml-auto text-meta text-fg-muted tabular-nums">
          {servingsEaten}× · <strong className="text-fg">{kcal}</strong> kcal · {prot}g protein
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" block onClick={onCancel}>Cancel</Button>
        <Button variant="primary" block onClick={() => onLog(servingsEaten)} loading={busy} disabled={servingsEaten <= 0}>
          Log {p}%
        </Button>
      </div>
    </div>
  )
}
