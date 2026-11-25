import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, FileText } from 'lucide-react'
import { Card, CardHeader, KeepRoom, Truncate } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useLatestReport } from '../../ai/claude/hooks/useReports'
import { reportHeadline } from '../../ai/claude/reportTiles'
import { isReportId, reportShownOn, reportSummary, reportWeekLabel } from '../../ai/claude/reportRules'
import { ReportChange } from '../../ai/components/ReportChange'

// The popup loads when it is first opened (Home's first download stays within its budget); once opened it stays mounted,
// so it closes with its own animation.
const WeeklyReportSheet = lazy(() => import('../../ai/components/WeeklyReportSheet').then(m => ({ default: m.WeeklyReportSheet })))

/**
 * Home's Weekly report card (owner, 22.11.2026: a card on Home and a push on the phone). It shows only when a finished
 * real (scheduled) report exists and today is in the week after its week (Monday to Sunday); it shows the week and three or
 * four of its figures from the saved figures (`reportHeadline`: never the model's text), each with its change as a tone,
 * and opens the report (owner, 25.11.2026: a compact summary, not a line of text). The card is an addition and a failed read leaves nothing (never
 * an empty card). A push opens it too: `#/home?report=<id>`; the address is read here, the id checked, and the
 * address cleaned when the sheet closes. It keeps the room it took last time on this device (THEME §5), so the cards
 * under it do not jump when it appears. The daily brief above it stays rule-based: this card is the one AI text on Home.
 */
/** The week's three or four figures, each with its change; a report with none keeps the one line it had. */
function ReportHeadline({ facts }: { facts: Record<string, unknown> }) {
  const figures = reportHeadline(facts)
  if (figures.length === 0) return <Truncate as="p" lines={2} className="text-body text-fg-2">{reportSummary(facts) || 'The week in short, written by the model.'}</Truncate>
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 @[30rem]:grid-cols-4">
      {figures.map(f => (
        <div key={f.key} className="min-w-0">
          <dt className="text-meta text-fg-muted">{f.label}</dt>
          <dd className="flex min-w-0 items-baseline gap-1">
            <span className="text-lead font-semibold tabular-nums text-fg">{f.value}</span>
            {f.unit && <Truncate className="min-w-0 text-meta text-fg-muted">{f.unit}</Truncate>}
          </dd>
          {f.change && <dd><ReportChange change={f.change} short /></dd>}
        </div>
      ))}
    </dl>
  )
}

export function WeeklyReportCard() {
  const { data: report, isLoading, isError } = useLatestReport()
  const [params, setParams] = useSearchParams()
  const asked = params.get('report')
  const openId = isReportId(asked) ? asked : null
  const [everOpened, setEverOpened] = useState(false)
  if (openId && !everOpened) setEverOpened(true)
  // An address that names something else is dropped, so a stale link never leaves a dead parameter behind.
  useEffect(() => {
    if (asked !== null && !isReportId(asked)) setParams(p => { const n = new URLSearchParams(p); n.delete('report'); return n }, { replace: true })
  }, [asked, setParams])
  const open = (id: string | null) => setParams(p => {
    const n = new URLSearchParams(p)
    if (id) n.set('report', id); else n.delete('report')
    return n
  }, { replace: !id })

  // The card is for the week after the report's week (Monday to Sunday), and only for the real (scheduled) report.
  const shown = !isError && report && reportShownOn(report, todayStr()) ? report : null
  return (
    <>
      <KeepRoom ids="home:weekly-report" loading={isLoading} first="none" remember={!isError}>
        {shown && (
          <Card as="button" interactive type="button" className="w-full @container" aria-label="Open the weekly report" onClick={() => open(shown.id)}>
            <CardHeader title="Weekly report" subtitle={reportWeekLabel(shown.week_start)} icon={<FileText />} className="mb-2.5"
              action={<ChevronRight aria-hidden className="h-4 w-4 text-fg-faint" />} />
            <ReportHeadline facts={shown.facts} />
          </Card>
        )}
      </KeepRoom>
      {(openId || everOpened) && <Suspense fallback={null}><WeeklyReportSheet id={openId} onClose={() => open(null)} /></Suspense>}
    </>
  )
}
