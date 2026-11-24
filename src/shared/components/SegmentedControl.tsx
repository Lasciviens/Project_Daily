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
  /** `sm`: smaller text; `xs`: a 28px pill row for a compact header (This day | All days). */
  size?: 'xs' | 'sm' | 'md'
  /**
   * Each segment as wide as its own label, with tighter sides, instead of equal shares: five views with one
   * long name ("How it works") fit a phone's width on one line (Developer → AI).
   */
  fit?: boolean
  /** What the control switches, for screen readers. */
  label?: string
}

// iOS-style segmented control. Generic over a string-union value so callers get
// exhaustive typing on `value`/`onChange` without casting.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fullWidth = false,
  size = 'md',
  fit = false,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={[
        'seg',
        size === 'xs' ? 'seg-xs' : '',
        fit ? 'seg-fit auto-cols-auto' : '',
        fullWidth ? 'w-full' : '',
      ].join(' ')}
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
              'seg-btn flex items-center justify-center gap-1.5 whitespace-nowrap',
              size === 'sm' ? 'text-meta' : '',
              isActive ? '' : 'hover:text-fg',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
