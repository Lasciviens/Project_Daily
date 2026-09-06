import { useState } from 'react'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useBodyCompositionReports } from '../../hooks/useBodyCompositionReports'
import { latestAndPrevious, reportsInWindow, BODY_COMP_WINDOWS, type BodyCompWindow } from '../../bodyCompositionAggregate'
import { BodyCompStatGrid } from './BodyCompStatGrid'
import { BodyCompTrendChart } from './BodyCompTrendChart'
import { BodyCompHistoryTable } from './BodyCompHistoryTable'

// Smart-scale "body composition analysis report" scans (migration 085,
// imported via phone-gateway's import_body_composition action — see
// CLAUDE.md's iPhone surface section). Rendered inside BodySection, its OWN
// card, deliberately separate from the Apple-Health-sourced weight/fat/BMI/
// lean-mass mini-charts above it: a DIFFERENT source (a dedicated smart
// scale, not Health Auto Export or Hevy) with a much richer field set (14
// measured values vs. 4), never merged or joined with either per CLAUDE.md's
// explicit rule.
export function BodyCompositionPanel() {
  const { data: reports = [], isLoading } = useBodyCompositionReports()
  const [window, setWindow] = useState<BodyCompWindow>('90d')

  if (isLoading) return null
  if (reports.length === 0) {
    return (
      <div className="pt-3 border-t border-ink-100 flex flex-col gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">📟 Smart Scale Reports</p>
        <p className="text-xs text-ink-400">
          No scans yet — share a "Body composition analysis report" photo to the phone shortcut to import one.
        </p>
      </div>
    )
  }

  const { latest, previous } = latestAndPrevious(reports)
  const windowed = reportsInWindow(reports, window)

  return (
    <div className="pt-3 border-t border-ink-100 flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">📟 Smart Scale Reports</p>
        <InfoBubble label="About smart scale reports">
          Imported from a smart-scale report photo via the phone shortcut — a separate device from Apple Health and Hevy,
          never merged with either. Averages and trend below use whichever period is selected; the stat cards always
          compare the latest scan to the one right before it, regardless of the period.
        </InfoBubble>
      </div>

      <p className="text-[11px] text-ink-400">
        Latest scan: <span className="font-semibold text-ink-600">{new Date(latest!.measured_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        {' · '}{reports.length} scan{reports.length === 1 ? '' : 's'} total
      </p>

      <BodyCompStatGrid latest={latest!} previous={previous} />

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-300">Trend</p>
        <div className="flex gap-1">
          {BODY_COMP_WINDOWS.map(w => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindow(w.key)}
              className={`min-h-[28px] px-2 rounded-md text-[11px] font-semibold ${
                window === w.key ? 'bg-accent-500 text-white' : 'text-ink-500 hover:bg-cream-100'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <BodyCompTrendChart reportsInWindow={windowed} />

      <BodyCompHistoryTable reports={reports} />
    </div>
  )
}
