import { cx } from '../../../shared/ui'

/** Done-share bar with counts, shared by the project card and the detail header. */
export function ProjectProgress({ total, done, inProgress, thick, className }: {
  total: number
  done: number
  inProgress: number
  thick?: boolean
  className?: string
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Items done"
        className={cx('overflow-hidden rounded-full bg-surface-2', thick ? 'h-2' : 'h-1.5')}
      >
        <div className="h-full bg-success transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-meta text-fg-muted tabular-nums">
        <span>{total > 0 ? `${done}/${total} done` : 'No items yet'}</span>
        <span className="flex items-center gap-2">
          {inProgress > 0 && <span className="font-medium text-accent-600">{inProgress} in progress</span>}
          {total > 0 && <span className="font-semibold text-fg-2">{pct}%</span>}
        </span>
      </div>
    </div>
  )
}
