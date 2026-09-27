import { useState } from 'react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { useBodyCompositionReports } from '../hooks/useBodyCompositionReports'
import { latestAndPrevious, reportsInWindow, BODY_COMP_FIELDS, BODY_COMP_WINDOWS, type BodyCompWindow } from '../bodyCompositionAggregate'
import { BodyCompStatGrid } from './BodyCompStatGrid'
import { BodyCompTrendChart } from './BodyCompTrendChart'
import { BodyCompHistoryTable } from './BodyCompHistoryTable'
import { SegmentedControl } from '../../../shared/ui'
import { fmtDateTimeEnGB } from '../../../shared/utils/enGBDate'

// Smart-scale "body composition analysis report" scans (migration 085,
// imported via phone-gateway's import_body_composition action — see
// CLAUDE.md's iPhone surface section). Weight and body fat % are NOT repeated
// here: the scale's readings already feed the ONE weight and body-fat charts
// above (bodyweight.ts merges scale, Hevy and Apple Health), and two "Weight"
// charts in one card disagreed (H-12). This panel keeps what only the scale
// measures; the full scan table below still lists every field.
const SCALE_ONLY_FIELDS = BODY_COMP_FIELDS.filter(f => f.key !== 'weight_kg' && f.key !== 'body_fat_percent')

export function BodyCompositionPanel() {
  const { data: reports = [], isLoading } = useBodyCompositionReports()
  const [window, setWindow] = useState<BodyCompWindow>('90d')

  if (isLoading) return <div className="h-24 rounded-row skeleton" aria-hidden />
  if (reports.length === 0) {
    return (
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="section-label">Smart scale reports</p>
        <p className="text-meta text-fg-muted">
          No scans yet — share a "Body composition analysis report" photo to the phone shortcut to import one.
        </p>
      </div>
    )
  }

  const { latest, previous } = latestAndPrevious(reports)
  const windowed = reportsInWindow(reports, window)

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex items-center gap-1.5">
        <p className="section-label">Smart scale reports</p>
        <InfoBubble label="About smart scale reports">
          Imported from a smart-scale report photo via the phone shortcut. The scale's weight and body fat % appear in the
          weight and body-fat charts above; everything else it measures is here. Averages and trend below use whichever
          period is selected; the stat cards always compare the latest scan to the one right before it.
        </InfoBubble>
      </div>

      <p className="text-meta text-fg-muted">
        Latest scan: <span className="font-semibold tabular-nums text-fg-2">{fmtDateTimeEnGB(new Date(latest!.measured_at), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        {' · '}{reports.length} scan{reports.length === 1 ? '' : 's'} total
      </p>

      <BodyCompStatGrid latest={latest!} previous={previous} fields={SCALE_ONLY_FIELDS} />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="section-label">Trend</p>
        <SegmentedControl<BodyCompWindow>
          size="sm"
          value={window}
          onChange={setWindow}
          options={BODY_COMP_WINDOWS.map(w => ({ value: w.key, label: w.label }))}
        />
      </div>
      <BodyCompTrendChart reportsInWindow={windowed} fields={SCALE_ONLY_FIELDS} />

      <BodyCompHistoryTable reports={reports} />
    </div>
  )
}
