import { Sparkles } from 'lucide-react'
import { MetaLine } from '../../../shared/ui'
import { readAsParts } from '../sheetRules'
import type { QuickAddResult } from '../quickAdd'

/**
 * What quick add read from the typed text — "Read as “Gym” · 17:30–18:30 ·
 * Every week on Mon, Wed and Fri" — with "Keep text" to take it all back. The
 * Add sheet's title and Home's quick add show the same line.
 */
export function ReadAsLine({ parse, start, onKeepText }: {
  parse: QuickAddResult
  /** The date a repeat starts on when the text names none. */
  start: string
  onKeepText: () => void
}) {
  const parts = readAsParts(parse, start)
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-meta text-fg-muted" aria-live="polite">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600" aria-hidden />
      <p className="min-w-0 flex-1 break-words">
        Read as{' '}
        {parse.title && <span className="font-medium text-fg-2">“{parse.title}”</span>}
        {parse.title && parts.length > 0 && ' · '}
        <MetaLine as="span" items={parts} />
      </p>
      <button type="button" onClick={onKeepText} className="shrink-0 font-semibold text-accent-600 hover:underline">
        Keep text
      </button>
    </div>
  )
}
