import { CalendarX2 } from 'lucide-react'
import { TGA_CARD, TGA_GRID, TGA_ORDER_RATINGS, TGA_SPAN_RECENT, TGA_SPAN_WIDE } from './tgAnalyticsFormat'

const BONE = 'tg-skeleton rounded-md'

function CardBones({ className = '', rows = 5, chart = false }: { className?: string; rows?: number; chart?: boolean }) {
  return (
    <div className={`${TGA_CARD} p-5 ${className}`}>
      <div className={`${BONE} h-3 w-28`} />
      {chart ? (
        <div className="mt-6 flex h-[180px] items-end gap-2">
          {[38, 62, 45, 80, 30, 55, 70, 42, 90, 50, 64, 36].map((h, i) => (
            <div key={i} className={`${BONE} flex-1 rounded-t-[4px] rounded-b-none`} style={{ height: `${h}%` }} />
          ))}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`${BONE} h-4 w-4 rounded-full`} />
              <div className={`${BONE} h-3 w-20`} />
              <div className={`${BONE} h-2.5`} style={{ width: `${70 - i * 11}%` }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The screen's own shape while the library loads — same grid, same cards, no jump when it lands. */
export function TgAnalyticsSkeleton() {
  return (
    <div aria-busy aria-label="Loading analytics" className="flex flex-col gap-5">
      <div className="flex gap-2">
        {[76, 118, 90, 104].map(w => <div key={w} className={`${BONE} h-[34px] rounded-full`} style={{ width: w }} />)}
      </div>
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @[62rem]:grid-cols-6 @[62rem]:gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${TGA_CARD} p-4`}>
            <div className="flex items-center gap-2.5"><div className={`${BONE} h-8 w-8 rounded-[10px]`} /><div className={`${BONE} h-3 w-16`} /></div>
            <div className={`${BONE} mt-4 h-6 w-20`} />
            <div className={`${BONE} mt-3 h-3 w-28`} />
          </div>
        ))}
      </div>
      <div className={TGA_GRID}>
        <CardBones chart className={TGA_SPAN_WIDE} />
        <CardBones rows={5} />
        <CardBones chart className={TGA_ORDER_RATINGS} />
        <CardBones rows={7} />
        <CardBones rows={8} />
        <CardBones rows={7} />
        <CardBones rows={4} className={TGA_SPAN_RECENT} />
      </div>
    </div>
  )
}

/** The library has games, but none in this window (or library). */
export function TgAnalyticsScopeEmpty({ range, windowed, filtered, onAllTime, onAllLibraries }: {
  range: string
  windowed: boolean
  filtered: boolean
  onAllTime: () => void
  onAllLibraries: () => void
}) {
  return (
    <div className={`${TGA_CARD} tg-fade-in flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center`}>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
        <CalendarX2 size={26} strokeWidth={1.75} aria-hidden />
      </span>
      <h2 className="mt-4 text-[17px] font-semibold text-[var(--tg-text)]">Nothing played {range}</h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-[var(--tg-muted)]">
        No game in this view was played, started or finished in this period. A longer window, or every library, will have numbers to show.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {windowed && <button type="button" className="tg-btn tg-btn-primary" onClick={onAllTime}>Show all time</button>}
        {filtered && <button type="button" className="tg-btn tg-btn-secondary" onClick={onAllLibraries}>All libraries</button>}
      </div>
    </div>
  )
}
