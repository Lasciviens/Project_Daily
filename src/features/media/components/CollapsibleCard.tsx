import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, SkeletonText, useBoardStep } from '../../../shared/ui'
import { MEDIA_TOOLS_OPEN_FROM } from '../mediaBoard'

/**
 * A side-rail card whose body opens on demand. Closed by default; on a
 * PageBoard wide enough to give it a column of its own (MEDIA_TOOLS_OPEN_FROM)
 * it starts open, so the column shows content rather than a closed bar.
 * `loading` (the library is still arriving) shows placeholder lines instead
 * of the body, so an open card never claims "nothing here" before it knows.
 */
export function CollapsibleCard({ title, icon, badge, loading = false, openFrom = MEDIA_TOOLS_OPEN_FROM, children }: {
  title: string
  icon: ReactNode
  badge?: ReactNode
  loading?: boolean
  /** The board step from which the card starts open. */
  openFrom?: number
  children: ReactNode
}) {
  const step = useBoardStep()
  const [open, setOpen] = useState(() => step >= openFrom)
  return (
    <Card padded={false}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center gap-2.5 rounded-card px-4 text-left sm:px-5"
      >
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        <span className="flex-1 text-lead font-semibold text-fg">{title}</span>
        {!loading && badge}
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-4 sm:px-5 sm:pb-5">{loading ? <SkeletonText lines={3} /> : children}</div>}
    </Card>
  )
}
