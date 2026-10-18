import { cx } from '../../../shared/ui'

/** A thin done-share bar (0–1). */
export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}
      className={cx('h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <div className="h-full rounded-full bg-accent-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
    </div>
  )
}
