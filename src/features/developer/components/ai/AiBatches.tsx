import { useState } from 'react'
import { ChevronDown, FileText, RefreshCw } from 'lucide-react'
import { Button, MetaLine, Skeleton, TonePill, cx } from '../../../../shared/ui'
import { formatDateTime } from '../../../../shared/utils/dateFormat'
import { useCheckReportsNow, useMakeReportNow } from '../../../ai/claude/hooks/useReportActions'
import { useReportCosts, useReports } from '../../../ai/claude/hooks/useReports'
import { formatUsd } from '../../../ai/claude/ledgerRules'
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE, reportWeekLabel, type AiReport } from '../../../ai/claude/reportRules'
import { WeeklyReportText } from '../../../ai/components/WeeklyReportText'
import { ReadFailed } from './aiBits'

// Developer → AI → Learn → Batches: the weekly report's queue. A batch is a job that can wait: Anthropic answers it
// within hours (usually one) at half the price. Each row is a report: its week, who made it, how far it is, what it
// cost at the batch price (a waiting one is held at its worst case until the real cost is known) and, opened, the
// report or the sentence that says why there is none. The two buttons ask the `claude` function for the same two
// steps the timers do: queue this week's report now, and read back a waiting one.

function costLabel(report: AiReport, cost: { cost_usd: number; outcome: string } | undefined): string | null {
  if (!cost) return null
  if (report.status === 'queued') return `${formatUsd(cost.cost_usd)} held`
  return formatUsd(cost.cost_usd)
}

function Row({ report, cost }: { report: AiReport; cost: { cost_usd: number; outcome: string } | undefined }) {
  const [open, setOpen] = useState(false)
  const body = report.status === 'ready' && report.content
  return (
    <li>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors [@media(hover:hover)]:hover:bg-surface-hover">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-medium tabular-nums text-fg">{reportWeekLabel(report.week_start)}</span>
            <span className="shrink-0 text-body font-semibold tabular-nums text-fg">{costLabel(report, cost) ?? ''}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <TonePill tone={REPORT_STATUS_TONE[report.status]} className="shrink-0">{REPORT_STATUS_LABEL[report.status]}</TonePill>
            <MetaLine as="span" className="min-w-0 text-meta tabular-nums text-fg-muted" items={[
              report.made_by === 'app' ? 'Made by the button' : 'Sunday timer', 'batch price', formatDateTime(report.created_at),
            ]} />
          </span>
        </span>
        <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2 px-3 py-3">
          {body ? <WeeklyReportText content={report.content as string} />
            : <p className="text-body text-fg-muted">{report.status === 'queued' ? 'Waiting for Anthropic to answer. It is checked every 15 minutes, and Check now reads it back at once.' : report.failure ?? 'No report was made.'}</p>}
          {report.pushed_at && <p className="mt-2 text-meta text-fg-muted">Announced on the phone {formatDateTime(report.pushed_at)}.</p>}
        </div>
      )}
    </li>
  )
}

export function AiBatches() {
  const reports = useReports()
  const costs = useReportCosts((reports.data ?? []).map(r => r.call_id).filter((id): id is string => !!id))
  const make = useMakeReportNow()
  const check = useCheckReportsNow()
  const list = reports.data ?? []
  const waiting = list.some(r => r.status === 'queued')
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <section className="card flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4"><FileText /></span>
          <p className="min-w-0 text-body text-fg-2">
            The weekly report covers Training, Health, Food and Tasks &amp; time. Code works out every figure; the model only writes what they mean. It is queued on Sunday night at <span className="font-medium text-fg">half the price</span> (a batch) and is ready on Monday morning, on Home and as a push.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={make.isPending} onClick={() => make.mutate()}>Make this week’s report now</Button>
          <Button size="sm" icon={<RefreshCw />} loading={check.isPending} disabled={!waiting} onClick={() => check.mutate()}>Check now</Button>
        </div>
      </section>
      {reports.isLoading && <Skeleton rounded="rounded-card" className="h-24 w-full" />}
      {reports.isError && <ReadFailed what="the reports" error={reports.error} onRetry={() => { void reports.refetch() }} retrying={reports.isFetching} />}
      {!reports.isLoading && !reports.isError && list.length === 0 && (
        <p className="text-body text-fg-muted">No report yet. The first one is queued on the coming Sunday night, or press the button to try it now.</p>
      )}
      {list.length > 0 && (
        <ul className="card divide-y divide-line overflow-hidden" aria-label="Weekly reports">
          {list.map(r => <Row key={r.id} report={r} cost={r.call_id ? costs.data?.[r.call_id] : undefined} />)}
        </ul>
      )}
    </div>
  )
}
