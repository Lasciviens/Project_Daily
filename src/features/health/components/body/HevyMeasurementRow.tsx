import { useState } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'
import { IconButton, cx } from '../../../../shared/ui'
import { DETAIL_FIELDS, HERO_FIELDS, fmtMeasDate } from '../../../training/bodyMeasurementFields'
import type { MeasurementRow } from '../../hevyMeasurements'

const fmt = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 2 })

/** One older Hevy entry: its main values, the tape measurements on expand, and edit. */
export function HevyMeasurementRow({ row, onEdit }: { row: MeasurementRow; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const main = HERO_FIELDS.filter(f => row[f.key] != null)
  const tape = DETAIL_FIELDS.filter(f => row[f.key] != null)
  return (
    <li className="border-t border-line">
      <div className="flex min-h-[44px] items-center gap-2 py-1">
        <button type="button" onClick={() => tape.length && setOpen(o => !o)} disabled={!tape.length}
          aria-expanded={tape.length ? open : undefined}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left">
          <span className="w-24 shrink-0 text-body font-semibold tabular-nums text-fg-2">{fmtMeasDate(row.date)}</span>
          <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5 text-body">
            {main.map(f => (
              <span key={f.key}><span className="text-meta text-fg-muted">{f.label}</span> <b className="font-semibold tabular-nums text-fg">{fmt(row[f.key] as number)} {f.unit}</b></span>
            ))}
            {tape.length > 0 && <span className="text-meta text-fg-muted">+{tape.length} tape</span>}
          </span>
          {tape.length > 0 && <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', open && 'rotate-180')} />}
        </button>
        <IconButton label={`Edit the entry of ${fmtMeasDate(row.date)}`} onClick={onEdit} className="shrink-0"><Pencil /></IconButton>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-2 pb-3 sm:grid-cols-3 md:grid-cols-4">
          {tape.map(f => (
            <div key={f.key} className="rounded-row bg-surface-2 px-3 py-1.5">
              <p className="section-label">{f.label}</p>
              <p className="text-body font-semibold tabular-nums text-fg">{fmt(row[f.key] as number)} {f.unit}</p>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}
