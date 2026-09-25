import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TGA_CARD } from './tgAnalyticsFormat'

/**
 * One Analytics card: the 11px uppercase label, an optional muted summary on
 * the right, and the content. A container, so what sits inside can adapt to
 * the card's own width rather than the viewport's.
 */
export function TgAnalyticsCard({ label, meta, className = '', children }: {
  label: string
  meta?: ReactNode
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={`${TGA_CARD} @container flex flex-col p-5 ${className}`}>
      <header className="flex min-h-5 items-baseline justify-between gap-3">
        <h2 id={id} className="tg-section-label shrink-0">{label}</h2>
        {meta != null && <p className="min-w-0 truncate text-right text-[12px] text-[var(--tg-muted)]">{meta}</p>}
      </header>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/** A card with nothing to plot yet: says why, and what would fill it. */
export function TgAnalyticsEmpty({ icon: Icon, title, hint, className = '' }: {
  icon: LucideIcon
  title: string
  hint: string
  className?: string
}) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center rounded-[14px] border border-dashed border-[var(--tg-border-strong)] px-5 py-8 text-center ${className}`}>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
        <Icon size={19} strokeWidth={1.9} aria-hidden />
      </span>
      <p className="mt-3 text-[13px] font-semibold text-[var(--tg-text)]">{title}</p>
      <p className="mt-1 max-w-[18rem] text-[12px] leading-relaxed text-[var(--tg-muted)]">{hint}</p>
    </div>
  )
}
