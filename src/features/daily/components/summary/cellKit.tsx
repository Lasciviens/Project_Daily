import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { CardHeader, cx } from '../../../../shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared anatomy for the glance-board cells. Every module is one card in a
//  FIXED grid slot of TodaySummary (h-full, so a row's cards line up). Header =
//  icon chip + title + exactly one right-side control.
// ─────────────────────────────────────────────────────────────────────────────

export function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('card flex h-full min-w-0 flex-col gap-3 p-4', className)}>{children}</section>
}

export function CellHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return <CardHeader className="!mb-0 min-h-[44px]" icon={icon} title={title} action={action} />
}

// Quiet link-out in the card header (THEME §5: accent meta text + chevron).
export function CellLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[44px] shrink-0 items-center gap-0.5 px-1.5 text-meta font-semibold text-accent-600 transition-colors hover:text-accent-700"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  )
}
