import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { MetaLine, Truncate, cx, useBoardStep } from '../../../../shared/ui'
import { formatDateTime } from '../../../../shared/utils/dateFormat'
import { callModelLabel, formatDuration, formatTokens, formatUsd, jobTitleOf } from '../../../ai/claude/ledgerRules'
import type { AiCall, Describe } from '../../../ai/claude/types'
import { DETAIL_PANE_FROM } from '../../developerBoards'
import { AiCallDetail } from './AiCallDetail'
import { OutcomePill } from './aiBits'

// The ledger's rows (Developer → AI → Calls): when, the job and the cost on the first line; how it ended, the
// model, the tokens and the time it took on the second. A row opens its detail in place on phones and tablets
// and picks the call for the pane beside the list on wider pages — the page's own list + detail pattern.

/** "haiku-5-5": the model's id without the family prefix every one of them has. */
const shortModel = (model: string) => model.replace(/^claude-/, '')

function RowFace({ call, jobs }: { call: AiCall; jobs: Describe['jobs'] | undefined }) {
  const sent = call.input_tokens + call.cache_read_tokens + call.cache_write_5m_tokens + call.cache_write_1h_tokens
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2">
        <span className="shrink-0 text-meta tabular-nums text-fg-muted">{formatDateTime(call.created_at)}</span>
        <Truncate as="span" className="min-w-0 flex-1 text-body font-medium text-fg">{jobTitleOf(jobs, call.job)}</Truncate>
        <span className="shrink-0 text-body font-semibold tabular-nums text-fg">{formatUsd(call.cost_usd)}</span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <OutcomePill outcome={call.outcome} />
        <MetaLine as="span" className="min-w-0 text-meta tabular-nums text-fg-muted" items={[
          call.stop_reason === 'count_tokens' ? 'token count, free' : call.provider === 'page' ? callModelLabel(call) : shortModel(call.model),
          sent + call.output_tokens > 0 && `${formatTokens(sent)} in`,
          sent + call.output_tokens > 0 && `${formatTokens(call.output_tokens)} out`,
          formatDuration(call.duration_ms),
          call.job === 'chat' && `step ${call.step} of an answer`,
        ]} />
      </span>
    </span>
  )
}

export function AiCallList({ calls, jobs, picked, onPick }: {
  calls: AiCall[]
  jobs: Describe['jobs'] | undefined
  picked: string | null
  onPick: (id: string) => void
}) {
  const paneMode = useBoardStep() >= DETAIL_PANE_FROM
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {calls.map((call, index) => {
        // Ask AI's requests of one answer share a run (newest first): the earlier steps hang under the last one.
        const sameRun = call.job === 'chat' && index > 0 && calls[index - 1].run_id === call.run_id && calls[index - 1].job === 'chat'
        const open = !paneMode && expanded === call.id
        const selected = paneMode && picked === call.id
        return (
          <li key={call.id} className={cx(sameRun && 'border-l-2 border-line-strong bg-surface-2/40')}>
            <button
              type="button"
              onClick={() => (paneMode ? onPick(call.id) : setExpanded(e => (e === call.id ? null : call.id)))}
              aria-expanded={paneMode ? undefined : open}
              aria-current={selected ? 'true' : undefined}
              className={cx(
                'flex w-full items-center gap-2 py-2 pr-3 text-left transition-colors', sameRun ? 'pl-5' : 'pl-3',
                selected ? 'bg-accent-50' : '[@media(hover:hover)]:hover:bg-surface-hover',
              )}
            >
              <RowFace call={call} jobs={jobs} />
              {!paneMode && <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', open && 'rotate-180')} />}
            </button>
            {open && <div className="border-t border-line bg-surface-2 px-3 py-3"><AiCallDetail call={call} jobs={jobs} framed={false} /></div>}
          </li>
        )
      })}
    </ul>
  )
}
