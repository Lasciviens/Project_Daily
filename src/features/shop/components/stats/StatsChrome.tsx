import { Skeleton } from '../../../../shared/ui'

/** All time, then each year with money moving (newest first) — scopes net spend, money in and out, and stores. */
export function PeriodPicker({ years, value, onChange }: { years: string[]; value: string | null; onChange: (year: string | null) => void }) {
  return (
    <div role="tablist" aria-label="Period" className="scroll-x -mx-1 flex gap-1 px-1 pb-1">
      <button type="button" role="tab" aria-selected={value == null} onClick={() => onChange(null)} className="pill-tab press-feedback shrink-0">All time</button>
      {years.map(y => (
        <button key={y} type="button" role="tab" aria-selected={value === y} onClick={() => onChange(y)} className="pill-tab press-feedback shrink-0 tabular-nums">{y}</button>
      ))}
    </div>
  )
}

/** The screen's geometry while the rows load: the period row, four tiles, the chart. */
export function StatsSkeleton() {
  return (
    <div aria-busy="true" className="@container flex flex-col gap-3 sm:gap-4">
      <Skeleton rounded="rounded-full" className="h-9 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 @[44rem]:grid-cols-4">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} rounded="rounded-card" className="h-[5.75rem]" />)}
      </div>
      <Skeleton rounded="rounded-card" className="h-72 w-full max-w-4xl" />
      <Skeleton rounded="rounded-card" className="h-64 w-full max-w-4xl" />
    </div>
  )
}
