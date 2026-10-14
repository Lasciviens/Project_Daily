import { InfoBubble } from '../../../shared/components/InfoBubble'
import { localDayOf } from '../../../shared/utils/dateUtils'
import { useBodyCompositionReports } from '../hooks/useBodyCompositionReports'
import { latestAndPrevious, reportsBetween, BODY_COMP_FIELDS, type BodyCompFieldKey } from '../bodyCompositionAggregate'
import { BodyCompStatGrid } from './BodyCompStatGrid'
import { BodyCompTrendChart } from './BodyCompTrendChart'
import { BodyCompHistoryTable } from './BodyCompHistoryTable'
import { formatDateTime } from '../../../shared/utils/dateFormat'

// Smart-scale "body composition analysis report" scans (migration 085,
// imported via phone-gateway's import_body_composition action — see
// docs/features/iphone.md). Weight, body fat % and lean mass are
// NOT repeated here: the scale writes them into Apple Health, and the Body
// window's own charts above already draw them (two "Weight" charts in one
// card disagreed, H-12). This panel keeps what only the report carries; the
// full scan table below still lists every field. It follows the page's range
// bar: the latest scan is the newest on or before the viewed day, and the
// trend covers the picked period (it had its own 30D/90D/1Y/All chips,
// counted back from now, until the owner asked for one period everywhere).
const SHOWN_ABOVE: readonly BodyCompFieldKey[] = ['weight_kg', 'body_fat_percent', 'lean_body_mass_kg']
const SCALE_ONLY_FIELDS = BODY_COMP_FIELDS.filter(f => !SHOWN_ABOVE.includes(f.key))
const dayOf = (iso: string) => localDayOf(iso) ?? iso.slice(0, 10)

export function BodyCompositionPanel({ from, to }: { from: string; to: string }) {
  const { data: all = [], isLoading } = useBodyCompositionReports()

  if (isLoading) return <div className="h-24 rounded-row skeleton" aria-hidden />
  const reports = all.filter(r => dayOf(r.measured_at) <= to)
  if (reports.length === 0) {
    return (
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="section-label">Smart scale reports</p>
        <p className="text-meta text-fg-muted">
          No scans {all.length ? 'on or before this day' : 'yet'} — share a "Body composition analysis report" photo to the phone shortcut to import one.
        </p>
      </div>
    )
  }

  const { latest, previous } = latestAndPrevious(reports)
  const windowed = reportsBetween(reports, from, to, dayOf)

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex items-center gap-1.5">
        <p className="section-label">Smart scale reports</p>
        <InfoBubble label="About smart scale reports">
          Imported from a smart-scale report photo via the phone shortcut. The scale's weight, body fat % and lean mass
          are in the charts above; everything else the report measures is here. The trend below covers the period picked at
          the top of the page; the stat cards compare the latest scan with the one right before it.
        </InfoBubble>
      </div>

      <p className="text-meta text-fg-muted">
        Latest scan: <span className="font-semibold tabular-nums text-fg-2">{formatDateTime(latest!.measured_at)}</span>
        {' · '}{windowed.length} in this period
      </p>

      <BodyCompStatGrid latest={latest!} previous={previous} fields={SCALE_ONLY_FIELDS} />

      {from !== to && (
        <>
          <p className="section-label pt-1">Trend</p>
          <BodyCompTrendChart reportsInWindow={windowed} fields={SCALE_ONLY_FIELDS} />
        </>
      )}

      <BodyCompHistoryTable reports={reports} />
    </div>
  )
}
