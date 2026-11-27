import { cx } from './cx'

/**
 * An on/off control (THEME §5): the accent track when on. `md` keeps a 44px touch row of its own (a settings row);
 * `sm` sits inside a row that is already the touch target (the item screen's All-day, Date).
 */
export function Switch({ on, onChange, label, disabled, size = 'md' }: {
  on: boolean
  onChange: (v: boolean) => void
  /** What it switches, for screen readers ("All-day"). */
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cx('press-feedback flex shrink-0 items-center disabled:opacity-50', size === 'md' ? 'min-h-[44px] px-1' : 'py-1')}>
      {/* The thumb in rem like the track: at another Display scale it stays inside it (it ran out at 80 % in the harness). */}
      <span className={cx('relative inline-block h-6 w-11 rounded-full border transition-colors motion-reduce:transition-none',
        on ? 'border-accent-600 bg-accent-500' : 'border-line-strong bg-surface-2')}>
        <span className={cx('absolute top-0.5 h-[1.125rem] w-[1.125rem] rounded-full bg-surface shadow transition-[left] motion-reduce:transition-none',
          on ? 'left-[1.375rem]' : 'left-0.5')} />
      </span>
    </button>
  )
}
