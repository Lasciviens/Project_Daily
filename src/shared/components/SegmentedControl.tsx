import type { ReactNode } from 'react'

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
}

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  fullWidth?: boolean
  size?: 'sm' | 'md'
}

// iOS-style segmented control. Generic over a string-union value so callers get
// exhaustive typing on `value`/`onChange` without casting.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fullWidth = false,
  size = 'md',
}: SegmentedControlProps<T>) {
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <div
      role="tablist"
      className={[
        'gap-0.5 bg-cream-50 border border-ink-200 p-0.5 rounded-xl',
        fullWidth ? 'grid w-full' : 'inline-flex',
      ].join(' ')}
      // Dynamic column count only matters in fullWidth mode; inline-flex ignores it.
      style={fullWidth ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map(option => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={[
              'press-feedback min-h-[44px] px-3 rounded-lg font-semibold transition-colors',
              'flex items-center justify-center whitespace-nowrap',
              textSize,
              isActive ? 'bg-accent-500 text-white' : 'text-ink-600 hover:bg-ink-100',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
