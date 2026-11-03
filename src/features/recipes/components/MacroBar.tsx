import { MACRO_COLOR } from '../macroColors'

type Grams = { protein: number | null; carbs: number | null; fat: number | null }

interface Props extends Grams {
  /** Grams still to come (Food · Today's planned meals): drawn lighter after the eaten part. */
  planned?: Grams | null
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
type SegmentKey = typeof SEGMENTS[number]['key']

const kcalOf = (g: Grams) => Object.fromEntries(SEGMENTS.map(s => [s.key, (g[s.key] ?? 0) * s.kcalPerGram])) as Record<SegmentKey, number>
const sum = (k: Record<SegmentKey, number>) => k.protein + k.carbs + k.fat
const splitText = (k: Record<SegmentKey, number>) =>
  SEGMENTS.map(s => `${s.label.toLowerCase()} ${Math.round((k[s.key] / sum(k)) * 100)}%`).join(' · ')

/**
 * Proportional stacked bar showing what share of a recipe's calories come
 * from protein/carbs/fat (standard 4/4/9 kcal-per-gram conversion) — a more
 * visual read than three separate number badges. `planned` grams follow the
 * eaten ones in the same colours, lighter, so the bar is the day with its plan.
 */
export function MacroBar({ protein, carbs, fat, planned, showLegend = true, barClassName = 'h-2 rounded-full' }: Props) {
  const kcal = kcalOf({ protein, carbs, fat })
  const later = planned ? kcalOf(planned) : null
  const eatenTotal = sum(kcal)
  const plannedTotal = later ? sum(later) : 0
  const total = eatenTotal + plannedTotal
  if (total <= 0) return null
  const title = eatenTotal <= 0 ? 'Planned, not eaten yet'
    : `Calories from ${splitText(kcal)}${plannedTotal > 0 ? ' · the lighter part is planned, not eaten yet' : ''}`

  return (
    <div>
      <div className={`flex overflow-hidden bg-surface-2 ${barClassName}`} title={title}>
        {SEGMENTS.map(seg => {
          const pct = (kcal[seg.key] / total) * 100
          if (pct <= 0) return null
          return <div key={seg.key} style={{ width: `${pct}%`, backgroundColor: MACRO_COLOR[seg.key] }} />
        })}
        {later && SEGMENTS.map(seg => {
          const pct = (later[seg.key] / total) * 100
          if (pct <= 0) return null
          return <div key={`planned-${seg.key}`} className="opacity-40" style={{ width: `${pct}%`, backgroundColor: MACRO_COLOR[seg.key] }} />
        })}
      </div>
      {showLegend && eatenTotal > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {SEGMENTS.map(seg => {
            const pct = Math.round((kcal[seg.key] / eatenTotal) * 100)
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
