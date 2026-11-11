import { useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Truncate, cx } from '../../../../shared/ui'
import type { SectionId } from './recordSections'

/**
 * One of the record's sections: a row that opens it in place — its title, and
 * while folded a short summary of what is in it — and `action` beside it
 * while it is open (Check now, + Cost).
 */
export function RecordSection({ id, title, summary, open, onToggle, action, children }: {
  id: SectionId
  title: string
  summary?: ReactNode
  open: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  const bodyId = `${useId()}-${id}`
  return (
    <section className="rounded-row border border-line bg-surface">
      <div className={cx('flex items-center gap-1', open && action != null && 'pr-1')}>
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-row px-3 text-left transition-colors hover:bg-surface-hover">
          <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', !open && '-rotate-90')} />
          <h3 className="shrink-0 text-body font-semibold text-fg">{title}</h3>
          {!open && summary != null && summary !== '' && (
            <Truncate as="span" className="min-w-0 flex-1 text-right text-meta tabular-nums text-fg-muted">{summary}</Truncate>
          )}
        </button>
        {open && action}
      </div>
      {open && <div id={bodyId} className="flex flex-col gap-3 border-t border-line px-3 pb-3 pt-2.5">{children}</div>}
    </section>
  )
}
