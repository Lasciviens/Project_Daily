import { reviewCounts, type Point } from '../points'
import { cx } from '../../../shared/ui'

/**
 * A request's review at a glance: one thin bar, a segment per state —
 * fixed (success), not fixed (danger), moved (info), still to check (line).
 */
export function ReviewMeter({ points, className }: { points: readonly Point[]; className?: string }) {
  const c = reviewCounts(points)
  if (c.total === 0) return null
  const parts = [
    { n: c.fixed, tone: 'success' },
    { n: c.notFixed, tone: 'danger' },
    { n: c.moved, tone: 'info' },
  ] as const
  return (
    <div aria-hidden className={cx('flex h-1.5 w-full overflow-hidden rounded-full bg-line', className)}>
      {parts.map(p => p.n > 0 && (
        <span key={p.tone} data-tone={p.tone} style={{ width: `${(p.n / c.total) * 100}%` }} className="h-full bg-[rgb(var(--tone))]" />
      ))}
    </div>
  )
}
