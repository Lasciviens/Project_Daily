import { useState, type ReactNode } from 'react'
import { Skeleton, cx } from '../../../shared/ui'
import { BELT, spanPosition, type BeltKind, type PriceSpan } from '../wishTile'
import { money, num } from './shopFormat'

// The Wishlist's picture tiles (THEME.md §6.3 "Picture tiles"): the grid, the
// picture well, the history bar and the loading copy.

/**
 * Tiles flow into content-width columns (W2): two a row on a 375–402px phone,
 * more as the track widens — never wider tiles. 10rem is the most two columns
 * fit on the smallest phone (343px of content).
 */
export const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] items-stretch gap-2 sm:gap-3'

/**
 * The 4:3 picture well. Up to three photos on the soft well colour, each
 * multiplied onto it, so a store photo's white ground takes the well's colour
 * (dimmed in dark, no glare); with none, the thing's initials on its
 * category's tint. The belt crosses the top-left corner, `corner` sits top right.
 */
export function PictureWell({ srcs, initials, tint, belt, corner }: {
  srcs: readonly string[]
  initials: string
  /** The category's tint, 1–6 (wishTile.tintOf). */
  tint: number
  belt?: BeltKind | null
  corner?: ReactNode
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const shown = srcs.filter(s => !failed.has(s)).slice(0, 3)
  const drop = (src: string) => setFailed(f => new Set(f).add(src))
  const img = (src: string, className: string) => (
    <img key={src} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => drop(src)}
      className={cx('min-h-0 min-w-0 object-contain mix-blend-multiply', className)} />
  )
  return (
    <span data-tint={shown.length ? undefined : tint}
      className={cx('@container relative block aspect-[4/3] w-full overflow-hidden rounded-row', shown.length ? 'bg-well' : 'tint-fill')}>
      {shown.length === 0 ? (
        <svg aria-hidden viewBox="0 0 100 75" className="tint-ink absolute inset-0 h-full w-full">
          <text x="50" y="40" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="26" fontWeight="700" letterSpacing="1">{initials}</text>
        </svg>
      ) : shown.length === 1 ? (
        img(shown[0], 'absolute inset-0 h-full w-full p-[6%]')
      ) : (
        <span className={cx('absolute inset-0 grid gap-1 p-[5%]', shown.length === 2 ? 'grid-cols-2' : 'grid-cols-[3fr_2fr] grid-rows-2')}>
          {shown.map((src, i) => img(src, cx('h-full w-full', shown.length === 3 && i === 0 && 'row-span-2')))}
        </span>
      )}
      {belt && (
        <span data-tone={BELT[belt].tone}
          className="poster-belt pointer-events-none absolute left-[24cqw] top-[24cqw] w-[110cqw] -translate-x-1/2 -translate-y-1/2 -rotate-45 py-[3px] text-center text-micro font-bold uppercase leading-none tracking-[0.04em] shadow">
          {BELT[belt].label}
        </span>
      )}
      {corner && <span className="absolute right-1.5 top-1.5 flex">{corner}</span>}
    </span>
  )
}

/**
 * Today's price between the lowest and highest seen: "2 990 ━━●━━ 3 490".
 * Shown only with a history (two reads that differ).
 */
export function HistoryBar({ now, span }: { now: number; span: PriceSpan }) {
  const label = `Today ${money(now, span.currency)}: lowest seen ${money(span.low, span.currency)}, highest ${money(span.high, span.currency)} (${span.reads} reads)`
  return (
    <span role="img" aria-label={label} title={label} className="flex items-center gap-1.5 text-micro tabular-nums text-fg-muted">
      <span>{num(span.low)}</span>
      <span className="relative h-1 min-w-6 flex-1 rounded-full bg-line-strong">
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-fg-2"
          style={{ left: `${spanPosition(now, span) * 100}%` }} />
      </span>
      <span>{num(span.high)}</span>
    </span>
  )
}

/** A tile's loading copy: the well, two title lines, the price lines, the action row. */
export function TileSkeleton() {
  return (
    <div aria-hidden className="card flex flex-col p-1.5">
      <Skeleton rounded="rounded-row" className="aspect-[4/3] w-full" />
      <span className="flex flex-col gap-1.5 px-1.5 pb-2 pt-2.5">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="mt-1.5 h-4 w-3/5" />
        <Skeleton className="h-3 w-1/2" />
      </span>
      <span className="mt-auto border-t border-line pt-1"><Skeleton className="h-9 w-full" /></span>
    </div>
  )
}
