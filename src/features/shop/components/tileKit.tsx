import { useState, type CSSProperties, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton, Truncate, cx } from '../../../shared/ui'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { BELT, TILE_GRID, packGroups, spanPosition, tileTrack, type BeltKind, type PriceSpan } from '../wishTile'
import { money, num } from './shopFormat'
import { DisposalBadge, DisposalRibbon } from './DisposalRibbon'
import type { ShopDisposal, ShopItem } from '../types'

// The Wishlist's picture tiles (THEME.md §6.3 "Picture tiles"): the grid, the
// picture well (and its row-sized square for Owned's compact rows), the history
// bar and the loading copy.

/**
 * One category's tiles with its subcategories packed into shared rows
 * (`packGroups`), each named once above its own tiles. Every tile is one size
 * (`tileTrack`): two equal columns on a `narrow` list (a phone), else fixed
 * 12rem tracks, as many as the grid's own width holds (measured before the
 * first paint); until then the CSS grid (`TILE_GRID`) with the same tracks.
 */
export function PackedTiles({ id, subs, card, narrow }: {
  id: string
  subs: readonly { key: string; title: string | null; items: readonly ShopItem[] }[]
  card: (item: ShopItem) => ReactNode
  /** The whole list is under 40rem: two tiles to a row. */
  narrow: boolean
}) {
  const { ref, width } = useElementWidthRem()
  const labelled = subs.some(s => s.title)
  const track = width == null ? null : tileTrack(width, narrow)
  const tile = (item: ShopItem, style?: CSSProperties) => <div key={item.id} style={style} className="flex min-w-0 flex-col [&>*]:flex-1">{card(item)}</div>
  if (track == null) {
    return <div ref={ref} id={id} className={TILE_GRID}>{subs.flatMap(sub => sub.items.map(item => tile(item)))}</div>
  }
  return (
    <div ref={ref} id={id} className="grid items-start gap-2.5" style={{ gridTemplateColumns: track.template }}>
      {!labelled ? subs.flatMap(sub => sub.items.map(item => tile(item))) : packGroups(subs.map(s => s.items.length), track.cols).map(p => {
        const sub = subs[p.group]
        const at = { gridRow: p.line, gridColumn: `${p.col + 1} / span ${p.span}` }
        return p.label
          ? (
            <div key={`label:${sub.key}`} style={at} className={cx('-mb-1.5 min-w-0', p.line > 1 && 'pt-1')}>
              <Truncate as="p" className="section-label">{sub.title ?? 'Other'}</Truncate>
            </div>
          )
          : tile(sub.items[p.index], at)
      })}
    </div>
  )
}

/**
 * The 4:3 picture well. Up to three photos on the soft well colour, each
 * multiplied onto it, so a store photo's white ground takes the well's colour
 * (dimmed in dark, no glare); with none, its category's default picture — a
 * line icon drawn large on the category's tint, like Apple's placeholders —
 * else the thing's initials on the tint. A photo that fails to load falls
 * back the same way. The belt crosses the top-left corner, `corner` sits top
 * right.
 */
export function PictureWell({ srcs, icon: Icon, initials, tint, belt, corner }: {
  srcs: readonly string[]
  /** The category's default picture (useCategoryPictures), when it has one. */
  icon?: LucideIcon | null
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
      className={cx('@container relative block aspect-[4/3] w-full overflow-hidden rounded-row', shown.length ? 'bg-well' : Icon ? 'tint-well' : 'tint-fill')}>
      {shown.length === 0 ? (
        Icon
          ? <Icon aria-hidden strokeWidth={1.5} className="tint-ink absolute left-1/2 top-1/2 aspect-square h-[44%] w-auto -translate-x-1/2 -translate-y-1/2 opacity-75" />
          : (
            <svg aria-hidden viewBox="0 0 100 75" className="tint-ink absolute inset-0 h-full w-full">
              <text x="50" y="40" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="26" fontWeight="700" letterSpacing="1">{initials}</text>
            </svg>
          )
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
 * The picture well at a row's size (Owned's compact rows): a square with the
 * same order as a tile — the photo on the well colour, else the category's
 * default picture on its tint, else the initials; a photo that fails to load
 * falls back the same way.
 */
export function RowPicture({ src, icon: Icon, initials, tint, className, ribbon, left, size = 'md' }: {
  src: string | null
  /** How the thing left ("Sold", "Given away"): a banner across the foot of a big picture. */
  ribbon?: string | null
  /** How the thing left: a small icon badge in the corner of a row's or a line's picture. */
  left?: ShopDisposal | null
  /** `md` 40px (a row), `sm` 28px (a list line), `fill` the width it is given, square (a big picture). */
  size?: 'sm' | 'md' | 'fill'
  icon?: LucideIcon | null
  initials: string
  tint: number
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const photo = src && src !== failed ? src : null
  return (
    <span aria-hidden data-tint={photo ? undefined : tint}
      className={cx('relative grid shrink-0 place-items-center overflow-hidden rounded-row', size === 'fill' ? 'aspect-square w-full' : size === 'sm' ? 'h-7 w-7' : 'h-10 w-10', photo ? 'bg-well' : Icon ? 'tint-well' : 'tint-fill', className)}>
      {ribbon && <DisposalRibbon label={ribbon} />}
      {left && <DisposalBadge disposal={left} />}
      {photo
        ? <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(photo)} className="h-full w-full object-contain p-[8%] mix-blend-multiply" />
        : Icon
          ? <Icon strokeWidth={1.75} className={cx('tint-ink opacity-80', size === 'fill' ? 'h-10 w-10' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5')} />
          : <span className={cx('tint-ink font-bold tracking-[0.04em]', size === 'fill' ? 'text-title' : 'text-micro')}>{initials}</span>}
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

/** A tile's title: always two lines tall, cut by `Truncate` (a short one keeps the second line's room). */
export const TILE_TITLE = 'mx-1.5 mt-2 h-10 text-body font-semibold text-fg'
/** A tile's action row: one row of 36px controls (44 on touch), the same on every tile. */
export const TILE_ACTIONS = 'flex items-center gap-1 border-t border-line pt-1'

/**
 * A tile's three lines under its title, each one line tall whatever it holds, so every tile is one height (owner,
 * 24.11.2026): the price (with where it was read, cut at the end), the facts (a `MetaLine`, cut at the end), and one more
 * — a note or the price history — that keeps its room when there is none. Cut text says the whole in its title.
 */
export function TileLines({ price, meta, extra }: { price: ReactNode; meta: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-1.5 pb-2 pt-0.5">
      <span className="flex h-5 min-w-0 items-baseline gap-x-1 whitespace-nowrap text-meta text-fg-muted">{price}</span>
      <span className="flex h-4 min-w-0 items-center text-meta tabular-nums text-fg-muted">{meta}</span>
      <span className="flex h-4 min-w-0 items-center text-meta">{extra}</span>
    </div>
  )
}

/** A tile's loading copy at the tile's own fixed size: the well, the two-line title, the three lines, the action row. */
export function TileSkeleton() {
  return (
    <div aria-hidden className="card flex flex-col p-1.5">
      <Skeleton rounded="rounded-row" className="aspect-[4/3] w-full" />
      <span className="mx-1.5 mt-2 flex h-10 flex-col justify-center gap-1.5">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-2/3" />
      </span>
      <span className="flex flex-col gap-0.5 px-1.5 pb-2 pt-0.5">
        <span className="flex h-5 items-center"><Skeleton className="h-4 w-3/5" /></span>
        <span className="flex h-4 items-center"><Skeleton className="h-3 w-1/2" /></span>
        <span className="h-4" />
      </span>
      <span className={TILE_ACTIONS}><Skeleton className="h-9 w-full [@media(pointer:coarse)]:h-11" /></span>
    </div>
  )
}
