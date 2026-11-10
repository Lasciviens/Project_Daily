import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { daysBetween } from '../../ownModel'
import { hostWords } from '../../storeWords'
import type { Deadline } from '../../storeRules'

/** A rule's or a law's words as the app wrote them: "Return by 15.01.2027 — Elkjøp's Christmas returns, typed 10.11.2026". */
export function DeadlineWords({ deadline, notes = [], className }: { deadline: Deadline | null; notes?: readonly string[]; className?: string }) {
  if (!deadline && !notes.length) return null
  return (
    <div className={cx('flex flex-col gap-0.5 text-meta text-fg-muted', className)}>
      {deadline && <p>{deadline.words.replace(/^(Return|Complain) by \S+ — /, '')}</p>}
      {notes.map(n => <p key={n}>{n}</p>)}
    </div>
  )
}

/** One date with its label and a tone when it is near: "Return by 24.11.2026 · 14 days left". */
export function DateFact({ label, day, today, children, action }: { label: string; day: string | null; today: string; children?: ReactNode; action?: ReactNode }) {
  const left = day ? daysBetween(today, day) : null
  const tone = left === null ? null : left < 0 ? 'neutral' : left <= 1 ? 'danger' : left <= 3 ? 'warn' : null
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-meta font-medium text-fg-muted">{label}</span>
        <span className="text-body font-semibold tabular-nums text-fg">{day ? formatDate(day) : '—'}</span>
        {left !== null && (
          <span data-tone={tone ?? undefined} className={cx('text-meta tabular-nums', tone ? 'tone-text' : 'text-fg-muted')}>
            {left < 0 ? 'passed' : left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days left`}
          </span>
        )}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  )
}

/** A source's link as its host with ↗ — the address shows before it opens (its title has the whole link). */
export function SourceLink({ url, className }: { url: string | null; className?: string }) {
  const host = hostWords(url)
  if (!url || !host) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}
      className={cx('inline-flex items-center gap-0.5 font-medium text-accent-600 hover:underline', className)}>
      {host}<ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
    </a>
  )
}
