import type { ReactNode } from 'react'
import { Truncate } from '../../../../shared/ui'

/** A compact number tile for the session detail (a StatTile is a whole card —
 *  too big four-up inside a popup). */
export function SessionStat({ label, value, unit, sub }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-row bg-surface-2 px-3 py-2">
      <span className="section-label flex min-w-0 items-center gap-1">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-lead font-bold leading-tight tabular-nums text-fg">{value}</span>
        {unit && <span className="text-meta text-fg-muted">{unit}</span>}
      </span>
      {sub != null && <Truncate className="text-meta tabular-nums text-fg-muted">{sub}</Truncate>}
    </div>
  )
}
