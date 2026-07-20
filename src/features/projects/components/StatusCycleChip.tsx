import { haptic } from '../../../shared/utils/haptics'

interface Props<T extends string> {
  value:   T
  options: readonly T[]
  labels?: Partial<Record<T, string>>
  colors?: Partial<Record<T, string>>
  onCycle: (next: T) => void
}

const DEFAULT_PHASE_COLORS: Record<string, string> = {
  pending:     'bg-ink-100 text-ink-500',
  in_progress: 'bg-accent-50 text-accent-700',
  done:        'bg-emerald-50 text-emerald-700',
}

const DEFAULT_PROJECT_COLORS: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700',
  on_hold:   'bg-accent-50 text-accent-700',
  completed: 'bg-blue-50 text-blue-700',
  archived:  'bg-ink-100 text-ink-400',
}

export const PHASE_STATUS_COLORS   = DEFAULT_PHASE_COLORS
export const PROJECT_STATUS_COLORS = DEFAULT_PROJECT_COLORS

export function StatusCycleChip<T extends string>({ value, options, labels, colors, onCycle }: Props<T>) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const idx = options.indexOf(value)
    if (idx === -1) return
    haptic('light')
    const next = options[(idx + 1) % options.length]
    onCycle(next)
  }

  const colorMap  = colors ?? (DEFAULT_PHASE_COLORS as Partial<Record<T, string>>)
  const colorCls  = colorMap[value] ?? 'bg-ink-100 text-ink-500'
  const label     = labels?.[value] ?? value.replace('_', ' ')
  const idx       = options.indexOf(value)
  const nextLabel = idx !== -1 ? (labels?.[options[(idx + 1) % options.length]] ?? options[(idx + 1) % options.length].replace('_', ' ')) : ''

  // Compact coloured pill inside a transparent 44px tap target on mobile; the
  // pill itself stays small so it never balloons into a big coloured block.
  return (
    <button
      onClick={handleClick}
      title={nextLabel ? `Next: ${nextLabel}` : undefined}
      className="flex items-center justify-center flex-shrink-0 cursor-pointer min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
    >
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap hover:opacity-80 transition-opacity ${colorCls}`}>
        {label}
      </span>
    </button>
  )
}
