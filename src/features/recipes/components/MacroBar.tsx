interface Props {
  protein: number | null   // grams
  carbs:   number | null   // grams
  fat:     number | null   // grams
  /** Callers that already print the same split in grams next to the bar pass
   *  false — otherwise the percentages read as a duplicated macro row. */
  showLegend?: boolean
}

const SEGMENTS = [
  { key: 'protein', label: 'Protein', kcalPerGram: 4, color: 'bg-blue-400' },
  { key: 'carbs',   label: 'Carbs',   kcalPerGram: 4, color: 'bg-orange-400' },
  { key: 'fat',     label: 'Fat',     kcalPerGram: 9, color: 'bg-rose-400' },
] as const

/**
 * Proportional stacked bar showing what share of a recipe's calories come
 * from protein/carbs/fat (standard 4/4/9 kcal-per-gram conversion) — a more
 * visual read than three separate number badges.
 */
export function MacroBar({ protein, carbs, fat, showLegend = true }: Props) {
  const grams = { protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }
  const kcal  = {
    protein: grams.protein * 4,
    carbs:   grams.carbs   * 4,
    fat:     grams.fat     * 9,
  }
  const total = kcal.protein + kcal.carbs + kcal.fat
  if (total <= 0) return null

  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-ink-100">
        {SEGMENTS.map(seg => {
          const pct = (kcal[seg.key] / total) * 100
          if (pct <= 0) return null
          return <div key={seg.key} className={seg.color} style={{ width: `${pct}%` }} />
        })}
      </div>
      {showLegend && (
        <div className="flex items-center gap-3 mt-1.5">
          {SEGMENTS.map(seg => {
            const pct = Math.round((kcal[seg.key] / total) * 100)
            if (pct <= 0) return null
            return (
              <span key={seg.key} className="flex items-center gap-1 text-[10px] text-ink-500">
                <span className={`w-1.5 h-1.5 rounded-full ${seg.color}`} />
                {seg.label} {pct}%
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
