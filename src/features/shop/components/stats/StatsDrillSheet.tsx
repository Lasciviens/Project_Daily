import { ChevronRight, CornerDownRight } from 'lucide-react'
import { ModalShell, useEntityModal } from '../../../../shared/modals'
import { Truncate, cx } from '../../../../shared/ui'
import { AmountText } from '../shopKit'
import { shortReason } from './statsFormat'
import type { DrillContent, DrillRow } from './drillTypes'

/**
 * The things behind a Stats number: grouped rows (title, what happened and
 * when, the amount each adds); a row opens the thing's own popup above this
 * one, so Back returns here.
 */
export function StatsDrillSheet({ open, content, onClose }: { open: boolean; content: DrillContent | null; onClose: () => void }) {
  const modal = useEntityModal()
  if (!content) return null
  const empty = content.groups.every(g => g.rows.length === 0)
  return (
    <ModalShell open={open} onClose={onClose} title={content.title} subtitle={content.subtitle || undefined} size="md" bodyClassName="px-2 pb-4 pt-1 sm:px-3 sm:pb-5">
      {empty
        ? <p className="px-2 py-6 text-center text-body text-fg-muted">{content.empty}</p>
        : (
          <div className="flex flex-col gap-4">
            {content.groups.map(g => (
              <section key={g.key} aria-label={g.title ?? undefined}>
                {g.title && (
                  <header className="flex items-baseline justify-between gap-3 px-3 pb-1">
                    <h3 className="section-label">{g.title}</h3>
                    {g.total && <AmountText amount={g.total} unknown={shortReason(g.total)} className="text-meta font-semibold text-fg-2" />}
                  </header>
                )}
                <ul className="flex flex-col">
                  {g.rows.map(r => <li key={r.key}><DrillRowButton row={r} onOpen={() => modal.open({ kind: 'shop-item', id: r.id })} /></li>)}
                </ul>
              </section>
            ))}
          </div>
        )}
    </ModalShell>
  )
}

/**
 * One thing in a list: its title, what happened and when, and its amount (or
 * words); a tap opens it. An accessory sits indented under its item; a heading
 * row (the item, when its own row is not in the list) carries no amount.
 */
export function DrillRowButton({ row, onOpen }: { row: DrillRow; onOpen: () => void }) {
  const a = row.amount
  const value = row.header ? null : row.text != null
    ? <span className={cx('text-body tabular-nums', row.muted ? 'font-medium text-fg-muted' : 'font-semibold text-fg')}>{row.text}</span>
    : a
      ? (
        <span data-tone={row.tone} className={cx('text-body font-semibold', row.tone && 'tone-text')}>
          <AmountText amount={row.negate ? { ...a, nok: -a.nok } : a} signed={row.signed} unknown={shortReason(a)} />
        </span>
      )
      : null
  return (
    <button type="button" onClick={onOpen} className={cx('row row-interactive w-full py-1.5 text-left', row.depth === 1 && 'pl-5')}>
      {row.depth === 1 && <CornerDownRight aria-hidden className="-mr-1 h-3.5 w-3.5 shrink-0 self-start mt-1 text-fg-faint" />}
      <span className="min-w-0 flex-1">
        {row.depth === 1 && <span className="sr-only">Accessory: </span>}
        <Truncate className={cx('text-body font-medium', row.header ? 'text-fg-muted' : 'text-fg')}>{row.title}</Truncate>
        <Truncate className="text-meta text-fg-muted">{row.sub}</Truncate>
      </span>
      <span className="shrink-0 text-right">{value}</span>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
    </button>
  )
}
