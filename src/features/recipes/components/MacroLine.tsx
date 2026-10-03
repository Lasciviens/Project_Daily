import { cx } from '../../../shared/ui/cx'
import { MACRO_COLOR } from '../macroColors'

const fmt = (v: number | null | undefined) => (v == null ? '–' : v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))

/** "● P 42 g  ● C 50 g  ● F 14 g" — one coloured dot per macro, same colours as the rings and bars. */
export function MacroLine({ protein, carbs, fat, className }: {
  protein: number | null | undefined
  carbs: number | null | undefined
  fat: number | null | undefined
  className?: string
}) {
  const items = [
    { key: 'protein', short: 'P', label: 'Protein', v: protein },
    { key: 'carbs', short: 'C', label: 'Carbs', v: carbs },
    { key: 'fat', short: 'F', label: 'Fat', v: fat },
  ] as const
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta tabular-nums text-fg-muted', className)}>
      {items.map(m => (
        <span key={m.key} className="inline-flex items-center gap-1" title={`${m.label} ${fmt(m.v)} g`}>
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: MACRO_COLOR[m.key] }} />
          <span className="sr-only">{m.label}</span>
          <span aria-hidden>{m.short}</span>
          <span className="font-medium text-fg-2">{fmt(m.v)}</span>
        </span>
      ))}
    </span>
  )
}
