import { Check } from 'lucide-react'
import { MetaLine } from '../../../../shared/ui'
import type { Nudge } from '../../recordStory'
import { LookIcon } from '../lookIcon'

const ACTION: Record<NonNullable<Nudge['action']>, string> = { bought: 'Bought', value: 'Add', day: 'Add the day' }

/**
 * The record's one nudge line (recordStory.nudgeFor): the most useful next
 * step in Needs a look's words and tone — "Return by 15.11.2026 · in 5 days
 * · paid 4 490 NOK" — with the one thing the record can do about it at once
 * (Bought; the fact's editor for an estimate or a missing purchase day).
 */
export function RecordNudge({ nudge, onAction }: { nudge: Nudge; onAction: () => void }) {
  const facts = nudge.where && nudge.facts.length
    ? [...nudge.facts.slice(0, -1), <span key="w">{nudge.facts[nudge.facts.length - 1]} <span className="whitespace-normal break-words">{nudge.where}</span></span>]
    : nudge.facts
  const label = nudge.action ? (nudge.action === 'value' && nudge.kind === 'old_value' && nudge.key !== 'no_value' ? 'Update' : ACTION[nudge.action]) : null
  return (
    <div className="flex items-center gap-2.5 rounded-row border border-line bg-surface-2 px-3 py-1.5">
      <LookIcon look={nudge} small />
      <MetaLine as="p" className="min-w-0 flex-1 py-1 text-body tabular-nums text-fg-2" items={facts} />
      {label && (
        <button type="button" onClick={onAction} className="btn-ghost btn-sm shrink-0 gap-1 px-2 text-accent-600">
          {nudge.action === 'bought' && <Check aria-hidden className="h-4 w-4" />}{label}
        </button>
      )}
    </div>
  )
}
