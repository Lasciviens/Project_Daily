import { cx } from '../../../../shared/ui'

/** An on/off control (no shared switch exists yet). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="press-feedback flex min-h-[44px] shrink-0 items-center px-1 disabled:opacity-50">
      <span className={cx('relative inline-block h-6 w-11 rounded-full border transition-colors',
        on ? 'border-accent-600 bg-accent-500' : 'border-line-strong bg-surface-2')}>
        <span className={cx('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-surface shadow transition-[left]', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}
