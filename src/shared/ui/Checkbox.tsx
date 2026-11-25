import { cx } from './cx'

/**
 * A ticked / not ticked choice with its word (THEME §5): the browser's own
 * checkbox, the whole label is the target — 36px high (no 44px step on touch:
 * the app's controls keep touch targets comfortable without it, AGENTS.md). `tip` is the description (its title), starting with
 * the label's own word. `tint` colours the box with a category tint (§2.5)
 * when the box is also the key to that colour (the month calendar's kinds);
 * otherwise it is the accent.
 */
export function Checkbox({ checked, onChange, label, tip, tint, className }: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** One or two words. */
  label: string
  tip?: string
  tint?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}) {
  return (
    <label title={tip} data-tint={tint}
      className={cx('flex min-h-[36px] cursor-pointer select-none items-center gap-1.5 rounded-control text-meta text-fg-2', className)}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className={cx('h-4 w-4 shrink-0', tint ? 'tint-check' : 'accent-accent-500')} />
      <span className="whitespace-nowrap">{label}</span>
    </label>
  )
}
