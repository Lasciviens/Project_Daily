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
  return (
    <div
      role="tablist"
      className={[
        'seg',
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
