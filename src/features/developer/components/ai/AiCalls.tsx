import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ReceiptText, RefreshCw } from 'lucide-react'
import { Button, EmptyState, PageBoard, Skeleton } from '../../../../shared/ui'
import { useAiCalls, useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import { CALLS_PAGE_SIZE } from '../../../ai/claude/ledgerApi'
import { OUTCOME_META, formatCount } from '../../../ai/claude/ledgerRules'
import { CALL_OUTCOMES, type AiCallsFilter } from '../../../ai/claude/types'
import { LIST_DETAIL_BOARD, paneSelection, type ListDetailSection } from '../../developerBoards'
import { AiCallDetail } from './AiCallDetail'
import { AiCallList } from './AiCallRows'
import { ReadFailed } from './aiBits'

// Developer → AI → Calls: the ledger (ai_calls), newest first, a page at a time. The two filters are plain
// equality reads on indexed rows. On a wide page the picked call opens in a pane beside the list
// (developerBoards.ts → LIST_DETAIL_BOARD); on phones it opens in place under its row.

const NO_FILTER: AiCallsFilter = { job: '', outcome: '' }

export function AiCalls() {
  const [filter, setFilter] = useState<AiCallsFilter>(NO_FILTER)
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const about = useClaudeDescribe()
  const jobs = about.data?.jobs
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useAiCalls(filter, page)
  const calls = data?.calls ?? []
  const total = data?.total ?? 0
  const filtering = filter.job !== '' || filter.outcome !== ''

  const shownId = paneSelection(calls.map(c => c.id), picked)
  const shown = calls.find(c => c.id === shownId) ?? null
  const first = page * CALLS_PAGE_SIZE + 1
  const last = page * CALLS_PAGE_SIZE + calls.length

  function change(patch: Partial<AiCallsFilter>) {
    setFilter(f => ({ ...f, ...patch }))
    setPage(0)
  }

  let list: ReactNode
  if (isLoading) {
    list = <div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-[3.75rem]" />)}</div>
  } else if (error) {
    list = <ReadFailed what="the calls" error={error} onRetry={() => { void refetch() }} retrying={isFetching} />
  } else if (calls.length === 0) {
    list = (
      <EmptyState bordered icon={<ReceiptText />} title={filtering ? 'No calls match these filters' : 'No calls yet'}
        description={filtering ? 'Loosen the filters to see more.' : 'Every request to the model is listed here, with its tokens, its cost and how it ended. Try ✨ on the item screen.'} />
    )
  } else {
    list = <AiCallList calls={calls} jobs={jobs} picked={shownId} onPick={setPicked} />
  }

  const sections: Record<ListDetailSection, ReactNode> = {
    toolbar: (
      <div className="flex flex-wrap items-center gap-2">
        <select value={filter.job} onChange={e => change({ job: e.target.value })} aria-label="Job" className="select w-auto min-w-0 max-w-[11rem] flex-1 sm:flex-none">
          <option value="">All jobs</option>
          {(jobs ?? []).map(j => <option key={j.name} value={j.name}>{j.title}</option>)}
        </select>
        <select value={filter.outcome} onChange={e => change({ outcome: e.target.value })} aria-label="Outcome" className="select w-auto min-w-0 max-w-[11rem] flex-1 sm:flex-none">
          <option value="">All outcomes</option>
          {CALL_OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_META[o].label}</option>)}
        </select>
        <Button size="sm" className="ml-auto" icon={<RefreshCw className={isFetching ? 'animate-spin' : undefined} />} onClick={() => { void refetch() }} disabled={isFetching}>
          Refresh
        </Button>
      </div>
    ),
    list: (
      <div>
        {list}
        {!isLoading && !error && calls.length > 0 && (
          <div className="mt-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
            <p className="text-meta tabular-nums text-fg-muted">
              {total > CALLS_PAGE_SIZE ? `${formatCount(first)}–${formatCount(last)} of ${formatCount(total)} calls` : `${formatCount(total)} ${total === 1 ? 'call' : 'calls'}`}
            </p>
            {total > CALLS_PAGE_SIZE && (
              <div className="flex items-center gap-2">
                <Button size="sm" icon={<ChevronLeft />} disabled={page === 0 || isPlaceholderData} onClick={() => setPage(p => Math.max(0, p - 1))}>Newer</Button>
                <Button size="sm" icon={<ChevronRight />} disabled={last >= total || isPlaceholderData} onClick={() => setPage(p => p + 1)}>Older</Button>
              </div>
            )}
          </div>
        )}
      </div>
    ),
    // Nothing listed → no pane: the list's own empty state already says so.
    detail: isLoading || error || !shown ? null : <AiCallDetail key={shown.id} call={shown} jobs={jobs} framed />,
  }

  return <PageBoard sections={sections} layout={LIST_DETAIL_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
