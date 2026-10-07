import type { SpreadMonth } from '../spreadWatched'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** One thin bar per month: episodes that month. A month fully inside a break is a faint dash. */
export function SpreadMonthStrip({ months }: { months: SpreadMonth[] }) {
  if (months.length < 2) return null
  const max = Math.max(1, ...months.map(m => m.count))
  const firstYear = months[0].month.slice(0, 4)
  const lastYear = months[months.length - 1].month.slice(0, 4)
  return (
    <div className="mt-3">
      <div className={`flex h-8 items-end ${months.length > 60 ? '' : 'gap-px'}`} role="img" aria-label="Episodes per month">
        {months.map(m => {
          const name = `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`
          return (
            <div
              key={m.month}
              title={m.activeDays === 0 ? `${name} · break` : `${name} · ${m.count} episode${m.count === 1 ? '' : 's'}`}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              {m.activeDays === 0
                ? <span className="h-px w-full bg-line" />
                : <span className="w-full rounded-t-[2px] bg-accent-500" style={{ height: m.count ? `${Math.max(8, (m.count / max) * 100)}%` : '0' }} />}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-micro text-fg-faint tabular-nums">
        <span>{firstYear}</span>
        {lastYear !== firstYear && <span>{lastYear}</span>}
      </div>
    </div>
  )
}
