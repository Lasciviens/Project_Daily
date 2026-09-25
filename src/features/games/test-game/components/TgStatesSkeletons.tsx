import { useState } from 'react'
import { useShelfLayout } from './useShelfLayout'

// Placeholders shaped exactly like the view that replaces them, so the first
// paint of the library never jumps from one layout to another.

const Line = ({ className }: { className: string }) => <span className={`tg-skeleton block rounded ${className}`} />

/** The bookcase, same geometry as TgShelf (same layout hook), with empty cases. */
export function TgStatesShelfSkeleton() {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const { cols, rows, slotWidth, coverHeight, gap } = useShelfLayout(el)

  return (
    <div ref={setEl} className="tg-shelf h-full flex flex-col">
      {Array.from({ length: Math.max(2, rows) }, (_, r) => (
        <div key={r} className="tg-shelf-row flex-1 overflow-hidden" style={{ minHeight: coverHeight + 84 }}>
          <div className="flex pt-[18px] px-[44px] pb-[26px]" style={{ gap }}>
            {Array.from({ length: Math.max(1, cols) }, (_, c) => (
              <div key={c} className="relative shrink-0" style={{ width: slotWidth }}>
                <span aria-hidden className="tg-spot" />
                <div className="tg-cover-slot" style={{ height: coverHeight }}>
                  <span className="tg-skeleton block rounded" style={{ width: Math.round(coverHeight * 0.7), height: coverHeight }} />
                </div>
                <Line className="mt-2.5 h-3 w-3/4" />
                <Line className="mt-2 h-2.5 w-1/2" />
              </div>
            ))}
          </div>
          <span aria-hidden className="tg-plank" />
        </div>
      ))}
    </div>
  )
}

/** The dense cover wall (grid view). */
export function TgStatesGridSkeleton() {
  return (
    <div className="h-full overflow-hidden grid content-start gap-x-5 gap-y-6 grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i}>
          <span className="tg-skeleton block w-full aspect-[1/1.3] rounded" />
          <Line className="mt-2.5 h-3 w-3/4" />
          <Line className="mt-2 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  )
}

/** List rows (list view) or queue rows (Play Queue). */
export function TgStatesListSkeleton({ variant }: { variant: 'list' | 'queue' }) {
  const queue = variant === 'queue'
  return (
    <div className={`h-full overflow-hidden ${queue ? 'tg-panel p-1.5 sm:p-2' : ''}`}>
      {Array.from({ length: queue ? 6 : 9 }, (_, i) => (
        <div key={i} className={`flex items-center gap-4 px-3 ${queue ? 'min-h-[76px]' : 'min-h-[64px]'}`}>
          {queue && <Line className="hidden sm:block h-5 w-8" />}
          <span className={`tg-skeleton block shrink-0 rounded-md ${queue ? 'w-11 h-[60px]' : 'w-10 h-[54px]'}`} />
          <div className="flex-1 min-w-0">
            <Line className="h-3.5 w-2/5 max-w-[260px]" />
            <Line className="mt-2 h-2.5 w-1/4 max-w-[180px]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The phone's two-column card grid. */
export function TgStatesMobileSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <span className="tg-skeleton block w-full aspect-[0.72] rounded-md" />
          <Line className="mt-2 h-3 w-3/4" />
          <Line className="mt-1.5 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  )
}
