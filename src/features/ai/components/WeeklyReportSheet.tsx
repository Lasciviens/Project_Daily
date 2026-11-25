import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Skeleton } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { useReport, useReportCosts } from '../claude/hooks/useReports'
import { formatUsd } from '../claude/ledgerRules'
import { reportKindLabel, reportWeekLabel } from '../claude/reportRules'
import { WeeklyReportView } from './WeeklyReportView'

/**
 * The weekly report, opened from Home's card or from the push notification (`#/home?report=<id>`). The report is
 * read by its id (the database answers only the owner's own rows): its sections as cards (`WeeklyReportView`) on the
 * sheet's canvas. A test report (a copy, the week so far) says so beside its week.
 */
export function WeeklyReportSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useReport(id)
  const report = q.data
  const costs = useReportCosts(report?.call_id ? [report.call_id] : [])
  const cost = report?.call_id ? costs.data?.[report.call_id] : undefined
  const ready = report && report.status === 'ready' && report.content
  return (
    <ModalShell
      open={!!id}
      onClose={onClose}
      title="Weekly report"
      subtitle={report ? `${reportWeekLabel(report.week_start)}${report.made_by === 'app' ? ` · ${reportKindLabel(report)}` : ''}` : undefined}
      size="xl"
      grouped
      footer={(
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta tabular-nums text-fg-muted">{report?.ready_at ? `Made ${formatDateTime(report.ready_at)}` : ''}{cost ? ` · ${formatUsd(cost.cost_usd)} at batch price` : ''}</span>
          <Link to="/developer?tab=ai&view=learn&learn=batches" replace className="btn-secondary">
            Batches <ChevronRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      )}
    >
      {q.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton rounded="rounded-card" className="h-72 w-full" />
          <Skeleton rounded="rounded-card" className="h-72 w-full" />
        </div>
      )}
      {q.isError && <p role="alert" className="text-body text-fg-muted">Couldn’t load this report. Try again in a moment.</p>}
      {!q.isLoading && !q.isError && !report && <p className="text-body text-fg-muted">This report is no longer there.</p>}
      {ready && <WeeklyReportView facts={report.facts} content={report.content} weekStart={report.week_start} />}
      {report && report.status !== 'ready' && (
        <p className="text-body text-fg-muted">{report.status === 'queued' ? 'This report is still being written.' : report.failure ?? 'This report could not be made.'}</p>
      )}
    </ModalShell>
  )
}
