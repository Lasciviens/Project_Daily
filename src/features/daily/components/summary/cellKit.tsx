import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { CardHeader, Truncate, cx, type Tone } from '../../../../shared/ui'

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

// ─────────────────────────────────────────────────────────────────────────────
//  The one box every card on the board is made of (owner, 16.10.2026: "Not
//  horizontal. Make them in a box"; 26.10.2026: "Easy, understandable and
//  clear design!"): a small label with its icon, ONE big number or word, and
//  at most two short lines under it. A box that opens something is a button.
// ─────────────────────────────────────────────────────────────────────────────

export function StatBox({ icon, label, children, className, onClick, ariaLabel }: {
  icon?: ReactNode
  label: string
  children: ReactNode
  className?: string
  /** The box opens something (a session, a title, the food details). */
  onClick?: () => void
  /** Its name for a screen reader when it is a button (the label alone says little). */
  ariaLabel?: string
}) {
  const body = (
    <>
      <p className="flex min-w-0 items-center gap-1.5 section-label [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0">{icon}<Truncate as="span" className="min-w-0">{label}</Truncate></p>
      {children}
    </>
  )
  const cls = cx('flex min-w-0 flex-col gap-1 rounded-row bg-surface-2 p-3 text-left', className)
  return onClick
    ? <button type="button" onClick={onClick} aria-label={ariaLabel} className={cx(cls, 'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40')}>{body}</button>
    : <div className={cls}>{body}</div>
}

/** The box's one big number or word. `text`: a name from the owner's data
 *  (a session, an opponent) — up to two lines, the rest on tap (<Truncate>);
 *  a number stays one line, as on the Health card. */
export function StatValue({ children, tone, className, text = false }: { children: ReactNode; tone?: Tone; className?: string; text?: boolean }) {
  const cls = cx('min-w-0 text-title font-bold tabular-nums', tone ? 'tone-text' : 'text-fg', className)
  return text
    ? <Truncate as="p" lines={2} className={cx(cls, 'leading-tight')}><span data-tone={tone}>{children}</span></Truncate>
    : <p data-tone={tone} className={cx(cls, 'truncate leading-none')}>{children}</p>
}

/** A short line under the value. */
export function StatNote({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <p data-tone={tone} className={cx('min-w-0 text-meta', tone ? 'tone-text font-medium' : 'text-fg-muted', className)}>{children}</p>
}

/** What a box says while it loads or has nothing for the day. */
export function StatEmpty({ loading, text = 'No data' }: { loading: boolean; text?: string }) {
  return <p className="py-1 text-meta text-fg-muted">{loading ? '…' : text}</p>
}
