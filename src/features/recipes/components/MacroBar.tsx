import { MACRO_COLOR } from '../macroColors'

interface Props {
  protein: number | null   // grams
  carbs:   number | null   // grams
  fat:     number | null   // grams
  /** Callers that already print the same split in grams next to the bar pass
   *  false — otherwise the percentages read as a duplicated macro row. */
  showLegend?: boolean
  /** The bar's own size and shape (default a 8px rounded bar). */
  barClassName?: string
}

const SEGMENTS = [
  { key: 'protein', label: 'Protein', kcalPerGram: 4 },
  { key: 'carbs',   label: 'Carbs',   kcalPerGram: 4 },
  { key: 'fat',     label: 'Fat',     kcalPerGram: 9 },
] as const

/**
 * Proportional stacked bar showing what share of a recipe's calories come
 * from protein/carbs/fat (standard 4/4/9 kcal-per-gram conversion) — a more
 * visual read than three separate number badges.
 */
export function MacroBar({ protein, carbs, fat, showLegend = true, barClassName = 'h-2 rounded-full' }: Props) {
  const grams = { protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }
  const kcal = Object.fromEntries(SEGMENTS.map(s => [s.key, grams[s.key] * s.kcalPerGram])) as Record<typeof SEGMENTS[number]['key'], number>
  const total = kcal.protein + kcal.carbs + kcal.fat
  if (total <= 0) return null
  const split = SEGMENTS.map(s => `${s.label.toLowerCase()} ${Math.round((kcal[s.key] / total) * 100)}%`).join(' · ')

  return (
    <div>
      <div className={`flex overflow-hidden bg-surface-2 ${barClassName}`} title={`Calories from ${split}`}>
        {SEGMENTS.map(seg => {
          const pct = (kcal[seg.key] / total) * 100
          if (pct <= 0) return null
          return <div key={seg.key} style={{ width: `${pct}%`, backgroundColor: MACRO_COLOR[seg.key] }} />
        })}
      </div>
      {showLegend && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {SEGMENTS.map(seg => {
            const pct = Math.round((kcal[seg.key] / total) * 100)
            if (pct <= 0) return null
            return (
              <span key={seg.key} className="flex items-center gap-1 text-micro font-medium normal-case tracking-normal text-fg-muted tabular-nums">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MACRO_COLOR[seg.key] }} />
                {seg.label} {pct}%
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
