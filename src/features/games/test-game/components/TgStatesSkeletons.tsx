import { useState, type CSSProperties } from 'react'
import { SHELF_LABEL, textInset, useShelfLayout } from './useShelfLayout'

// Placeholders built from the same geometry and classes as the view that
// replaces them (TgShelf, TgGridView, TgMobileGrid, the list rows), so the
// first paint of the library never jumps from one layout to another.

const Bar = ({ className }: { className: string }) => <span className={`tg-skeleton block rounded ${className}`} />

/** Title + status/rating rows, at TgGameCard's exact line heights. */
function CardText({ titleLeading = 'h-[18px]', metaLeading = 'h-4' }: { titleLeading?: string; metaLeading?: string }) {
  return (
    <>
      <span className={`mt-2 flex items-center ${titleLeading}`}><Bar className="h-3 w-3/4" /></span>
      <span className={`mt-1 flex items-center justify-between ${metaLeading}`}>
        <Bar className="h-2.5 w-1/2" /><Bar className="h-2.5 w-6" />
      </span>
    </>
  )
}

/** An empty case standing in its cover slot, like TgCover's own placeholder. */
const Case = () => <span className="tg-skeleton aspect-[0.7] h-full max-w-full rounded-[4px]" />

/** The bookcase: TgShelf's layout hook, CSS geometry and row anatomy, with empty cases. */
export function TgStatesShelfSkeleton() {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const layout = useShelfLayout(el)
  const { rows, cols, measured } = layout
  const vars = {
    '--tg-card-w': `${layout.slotWidth}px`,
    '--tg-cover-h': `${layout.coverHeight}px`,
    '--tg-gap': `${layout.gap}px`,
    '--tg-half-gap': `${layout.gap / 2}px`,
    '--tg-row-h': `${layout.rowHeight}px`,
    '--tg-text-inset': `${textInset(layout)}px`,
  } as CSSProperties

  return (
    <div ref={setEl} className="h-full overflow-hidden rounded-2xl">
      <div className="tg-shelf min-h-full" style={vars}>
        {measured && Array.from({ length: rows }, (_, r) => (
          <div key={r} className="tg-shelf-row" style={{ height: 'var(--tg-row-h)' }}>
            <span aria-hidden className="tg-ceiling" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-[linear-gradient(180deg,var(--tg-shelf-edge),transparent),linear-gradient(180deg,var(--tg-shelf-edge),transparent_55%)]" />
            <span aria-hidden className="tg-plank" style={{ height: SHELF_LABEL }} />
            <div className="relative z-[2] flex h-full overflow-hidden px-11" style={{ gap: 'var(--tg-gap)' }}>
              {Array.from({ length: cols }, (_, c) => (
                <div key={c} className="tg-slot is-empty">
                  <span aria-hidden className="tg-spot" />
                  <span aria-hidden className="tg-lamp is-l" />
                  <span aria-hidden className="tg-lamp is-r" />
                  <div className="tg-card">
                    <span className="tg-cover-slot"><Case /></span>
                    <span className="tg-card-text"><CardText /></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The dense cover wall (TgGridView). */
export function TgStatesGridSkeleton() {
  return (
    <div className="h-full overflow-hidden [scrollbar-gutter:stable]">
      <div className="tg-cover-grid grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-6 px-3 pb-6 pt-4">
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className="tg-card">
            <span className="tg-cover-slot"><Case /></span>
            <span className="tg-card-text"><CardText /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** List-view rows (TgListView) or Play Queue rows (TgQueueView). */
export function TgStatesListSkeleton({ variant }: { variant: 'list' | 'queue' }) {
  if (variant === 'queue') {
    return (
      <div className="tg-panel h-full overflow-hidden space-y-1 p-1.5 sm:p-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex min-h-[76px] items-center gap-3 pl-2 sm:gap-4 sm:pl-3">
            <Bar className="hidden h-5 w-11 opacity-60 sm:block" />
            <span className="tg-skeleton block h-[60px] w-11 shrink-0 rounded-md" />
            <TwoLines />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="tg-panel h-full overflow-hidden px-2 pb-2">
      <div className="flex h-[38px] items-end gap-4 px-3.5 pb-2"><Bar className="ml-14 h-2.5 w-10" /><Bar className="h-2.5 w-12" /></div>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="p-0.5">
          <div className="flex min-h-[64px] items-center gap-4 px-3 py-1.5">
            <span className="tg-skeleton block h-[54px] w-10 shrink-0 rounded-md" />
            <TwoLines />
          </div>
        </div>
      ))}
    </div>
  )
}

function TwoLines() {
  return (
    <div className="min-w-0 flex-1">
      <Bar className="h-3.5 w-2/5 max-w-[260px]" />
      <Bar className="mt-2 h-2.5 w-1/4 max-w-[180px]" />
    </div>
  )
}

/** The phone's two-column card grid (TgMobileGrid). */
export function TgStatesMobileSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-1 pb-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i}>
          <span className="tg-skeleton block aspect-[0.72] w-full rounded-md" />
          <CardText titleLeading="h-[18px]" metaLeading="h-[14px]" />
        </div>
      ))}
    </div>
  )
}
