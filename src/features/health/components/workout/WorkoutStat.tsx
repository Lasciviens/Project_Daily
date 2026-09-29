import type { ReactNode } from 'react'

/** One compact figure in the workout detail (a StatTile is a whole card — too big here). */
export function WorkoutStat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-[5.5rem] flex-col gap-0.5 rounded-row bg-surface-2 px-3 py-2">
      <span className="section-label flex items-center gap-1">{label}</span>
      <span className="text-lead font-bold leading-none tabular-nums text-fg">{value}</span>
      {sub != null && <span className="text-micro font-normal text-fg-muted">{sub}</span>}
    </div>
  )
}
