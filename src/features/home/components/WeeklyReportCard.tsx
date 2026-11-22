import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Card, CardHeader, KeepRoom } from '../../../shared/ui'
import { useLatestReport } from '../../ai/claude/hooks/useReports'
import { isReportId, reportTeaser, reportWeekLabel } from '../../ai/claude/reportRules'

// The popup loads when it is first opened (Home's first download stays within its budget); once opened it stays mounted,
// so it closes with its own animation.
const WeeklyReportSheet = lazy(() => import('../../ai/components/WeeklyReportSheet').then(m => ({ default: m.WeeklyReportSheet })))

/**
 * Home's Weekly report card (owner, 22.11.2026: a card on Home and a push on the phone). It shows only when a finished
 * report exists — the newest week's — and opens it. The card is an addition and a failed read leaves nothing (never
 * an empty card). A push opens it too: `#/home?report=<id>`; the address is read here, the id checked, and the
 * address cleaned when the sheet closes. It keeps the room it took last time on this device (THEME §5), so the cards
 * under it do not jump when it appears. The daily brief above it stays rule-based: this card is the one AI text on Home.
 */
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

  const shown = !isError && report ? report : null
  return (
    <>
      <KeepRoom ids="home:weekly-report" loading={isLoading} first="none" remember={!isError}>
        {shown && (
          <Card as="button" interactive type="button" className="w-full" aria-label="Open the weekly report" onClick={() => open(shown.id)}>
            <CardHeader title="Weekly report" subtitle={reportWeekLabel(shown.week_start)} icon={<FileText />} className="mb-1" />
            <p className="line-clamp-2 break-words text-body text-fg-2">{reportTeaser(shown.content ?? '')}</p>
          </Card>
        )}
      </KeepRoom>
      {(openId || everOpened) && <Suspense fallback={null}><WeeklyReportSheet id={openId} onClose={() => open(null)} /></Suspense>}
    </>
  )
}
