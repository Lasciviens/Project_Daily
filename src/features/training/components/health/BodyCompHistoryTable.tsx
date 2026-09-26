import { useState } from 'react'
import type { BodyCompositionReport } from '../../api/bodyCompositionApi'
import { BODY_COMP_FIELDS } from '../../bodyCompositionAggregate'
import { fmtTrainingDateTime } from '../../dateFormat'
import { ChevronDown } from 'lucide-react'

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
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="btn-ghost btn-sm gap-1 self-start px-2 text-meta"
      >
        <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Hide' : 'Show'} all scans ({reports.length})
      </button>
      {open && (
        <div className="overflow-x-auto -mx-3 sm:mx-0">
          <table className="w-full border-collapse text-meta">
            <thead>
              <tr className="border-b border-line-strong">
                <th className="sticky left-0 whitespace-nowrap bg-surface px-2 py-1.5 text-left font-semibold text-fg-muted">Date</th>
                {BODY_COMP_FIELDS.map(f => (
                  <th key={f.key} className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-fg-muted">
                    {f.label}{f.unit && ` (${f.unit})`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-2 py-1.5 tabular-nums text-fg-2">{fmtTrainingDateTime(r.measured_at)}</td>
                  {BODY_COMP_FIELDS.map(f => (
                    <td key={f.key} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-fg-2">
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
