import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, TonePill, cx } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { outcomeMeta } from '../../../ai/claude/ledgerRules'
import { glossaryOf } from './aiGlossary'

// Small parts every view of Developer → AI shares.

/** A read that failed: what it was and Try again, on one compact line (THEME.md §5) — never an empty answer. */
export function ReadFailed({ what, error, onRetry, retrying, className }: {
  what: string
  error: unknown
  onRetry: () => void
  retrying?: boolean
  className?: string
}) {
  const why = error instanceof Error ? error.message : ''
  return (
    <p role="alert" className={cx('flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-fg-muted', className)}>
      <span data-tone="danger" className="tone-text inline-flex shrink-0"><AlertTriangle aria-hidden className="h-4 w-4" /></span>
      <span className="min-w-0 break-words">Couldn’t load {what}{why ? ` — ${why}` : ''}</span>
      <Button variant="ghost" size="sm" loading={retrying} onClick={onRetry}>Try again</Button>
    </p>
  )
}

/** How a call ended: its plain word on its tone. */
export function OutcomePill({ outcome, className }: { outcome: string; className?: string }) {
  const meta = outcomeMeta(outcome)
  return <TonePill tone={meta.tone} className={cx('shrink-0', className)}>{meta.label}</TonePill>
}

/** A label with an ⓘ that says the glossary's plain words for it. */
export function Term({ children, term, className }: { children: ReactNode; term: string; className?: string }) {
  const what = glossaryOf(term)
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      {children}
      {what && <InfoBubble label={`What “${term}” means`}>{what}</InfoBubble>}
    </span>
  )
}

/**
 * Logged or fixed text exactly as it is: a <pre> whose content is a text node — never HTML, never a link —
 * that wraps inside its box and scrolls past `tall`.
 */
export function PlainText({ children, className }: { children: string; className?: string }) {
  return (
    <pre className={cx('scroll-y max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-row bg-surface-2 p-3 font-mono text-meta text-fg-2', className)}>
      {children}
    </pre>
  )
}
