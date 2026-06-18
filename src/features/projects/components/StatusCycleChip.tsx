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
  on_hold:   'bg-amber-50 text-amber-700',
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
    const next = options[(idx + 1) % options.length]
    onCycle(next)
  }

  const colorMap  = colors ?? (DEFAULT_PHASE_COLORS as Partial<Record<T, string>>)
  const colorCls  = colorMap[value] ?? 'bg-ink-100 text-ink-500'
  const label     = labels?.[value] ?? value.replace('_', ' ')
  const idx       = options.indexOf(value)
  const nextLabel = idx !== -1 ? (labels?.[options[(idx + 1) % options.length]] ?? options[(idx + 1) % options.length].replace('_', ' ')) : ''

  return (
    <button
      onClick={handleClick}
      title={nextLabel ? `Next: ${nextLabel}` : undefined}
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize cursor-pointer hover:opacity-80 transition-opacity min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0 ${colorCls}`}
    >
      {label}
    </button>
  )
}
