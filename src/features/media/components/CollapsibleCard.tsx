import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '../../../shared/ui'

/** A side-rail card whose body opens on demand (closed by default). */
export function CollapsibleCard({ title, icon, badge, children }: {
  title: string
  icon: ReactNode
  badge?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
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
        {badge}
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>}
    </Card>
  )
}
