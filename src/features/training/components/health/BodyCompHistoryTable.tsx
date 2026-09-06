import { useState } from 'react'
import type { BodyCompositionReport } from '../../api/bodyCompositionApi'
import { BODY_COMP_FIELDS } from '../../bodyCompositionAggregate'
import { fmtTrainingDateTime } from '../../dateFormat'

// Every scan, every field — collapsed by default (Width Standard's "detail on
// demand" rule: secondary/raw detail lives behind a tap, not permanent screen
// area). A plain horizontally-scrolling table rather than a desktop-table/
// mobile-card split: 15 columns don't compress into a stacked card without
// either losing fields or growing very tall per row, and CLAUDE.md's own W2
// rule already sanctions overflow-x-auto for genuinely wide content like this.
export function BodyCompHistoryTable({ reports }: { reports: BodyCompositionReport[] }) {
  const [open, setOpen] = useState(false)
  // Newest first for browsing — the aggregate module's own sort is
  // chronological ascending (needed for trend math), so this reverses only
  // for display.
  const sorted = [...reports].reverse()

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="min-h-[44px] text-left text-[11px] font-bold uppercase tracking-wider text-ink-400 hover:text-ink-600"
      >
        {open ? '▲ Hide' : '▼ Show'} all scans ({reports.length})
      </button>
      {open && (
        <div className="overflow-x-auto -mx-3 sm:mx-0">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="text-left font-semibold text-ink-500 px-2 py-1.5 whitespace-nowrap sticky left-0 bg-cream-50">Date</th>
                {BODY_COMP_FIELDS.map(f => (
                  <th key={f.key} className="text-right font-semibold text-ink-500 px-2 py-1.5 whitespace-nowrap">
                    {f.icon} {f.label}{f.unit && ` (${f.unit})`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.id} className="border-b border-ink-100 last:border-0">
                  <td className="px-2 py-1.5 whitespace-nowrap text-ink-700 sticky left-0 bg-cream-50">{fmtTrainingDateTime(r.measured_at)}</td>
                  {BODY_COMP_FIELDS.map(f => (
                    <td key={f.key} className="text-right px-2 py-1.5 whitespace-nowrap text-ink-700 tabular-nums">
                      {r[f.key].toFixed(f.decimals)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
