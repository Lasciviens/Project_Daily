import { useMemo, useState } from 'react'
import { toGrams } from '../foodUnits'
import { Button, Truncate } from '../../../shared/ui'
import { sanitizeDecimal } from './foodLogUtils'
import type { RecipeWithIngredients } from '../types'

// Portion picker for a saved meal — the "I made a 2-portion batch, I ate 50%"
// flow. Free % of the WHOLE meal; when the recipe's total weight is computable
// (every ingredient has a weight) raw grams are offered too and kept in sync.
// servingsEaten = pct/100 × recipe.servings.
export function MealPortionPicker({ recipe, busy, onLog, onCancel }: {
  recipe: RecipeWithIngredients
  busy:   boolean
  onLog:  (servingsEaten: number) => void
  onCancel: () => void
}) {
  // Grams are offered only when every ingredient has a weight: a batch with
  // "2 eggs" in it has no honest total. It is the RAW weight of the batch.
  const totalG = useMemo(() => {
    let sum = 0
    for (const i of recipe.ingredients) {
      if (i.quantity == null) continue
      const g = toGrams(i.quantity, i.unit)
      if (g == null) return 0
      sum += g
    }
    return sum
  }, [recipe])
  const [pct, setPct] = useState('100')
  // What the user typed into grams, kept as typed — deriving grams back from a
  // rounded % made big batches snap (2400 g: "35" became "36").
  const [gramsDraft, setGramsDraft] = useState<string | null>(null)
  const p = Math.max(0, Number(sanitizeDecimal(pct)) || 0)
  const pLabel = Math.round(p * 10) / 10
  const pickPct = (v: string) => { setGramsDraft(null); setPct(v) }
  const servingsEaten = Math.round((p / 100) * recipe.servings * 100) / 100
  const kcal = Math.round((recipe.calories ?? 0) * servingsEaten)
  const prot = Math.round((recipe.protein_g ?? 0) * servingsEaten)
  const grams = totalG > 0 ? Math.round((p / 100) * totalG) : null

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-accent-500/25 bg-accent-50 p-3.5">
      <Truncate as="p" className="text-meta font-semibold text-accent-700">{`How much of “${recipe.title}” did you eat?`}</Truncate>
      <div className="flex flex-wrap gap-1.5">
        {[25, 50, 75, 100].map(v => (
          <button key={v} type="button" onClick={() => pickPct(String(v))} aria-pressed={p === v} className="pill-tab border border-line bg-surface">
            {v}%
          </button>
        ))}
      </div>
      {/* One row on a phone too: the amount boxes, then the result (it may wrap
          inside its own box, never onto a line of its own). */}
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-1">
          <input value={gramsDraft != null ? String(pLabel) : pct} onChange={e => pickPct(sanitizeDecimal(e.target.value))} inputMode="decimal" aria-label="Percent of the batch"
            className="input w-14 px-1.5 text-right tabular-nums" />
          <span className="text-meta text-fg-muted">%</span>
        </div>
        {grams != null && (
          <div className="flex shrink-0 items-center gap-1">
            <input
              value={gramsDraft ?? grams}
              aria-label="Grams eaten"
              onChange={e => {
                const raw = sanitizeDecimal(e.target.value)
                setGramsDraft(raw)
                setPct(totalG > 0 ? String(((Number(raw) || 0) / totalG) * 100) : '0')
              }}
              inputMode="decimal"
              className="input w-[4.5rem] px-1.5 text-right tabular-nums" />
            <span className="text-meta text-fg-muted" title="Raw weight: the ingredients before cooking">g raw</span>
          </div>
        )}
        <span className="ml-auto min-w-0 text-right text-meta leading-tight text-fg-muted tabular-nums">
          <span className="max-sm:hidden">{servingsEaten}× · </span><strong className="text-fg">{kcal}</strong> kcal · {prot}g protein
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" block onClick={onCancel}>Cancel</Button>
        <Button variant="primary" block onClick={() => onLog(servingsEaten)} loading={busy} disabled={servingsEaten <= 0}>
          Log {pLabel}%
        </Button>
      </div>
    </div>
  )
}
