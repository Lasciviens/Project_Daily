import { useState, type CSSProperties, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton, Truncate, cx } from '../../../shared/ui'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import {
  BELT, TILE_GAP_REM, TILE_GRID, TILE_LINE, TILE_LINES, TILE_NARROW_REM, TILE_REM, categoryLines, pictureColumns, pictureLines, spanPosition, tileBlocks, tileColumns,
  tilesRem, type BeltKind, type PriceSpan, type TileLayout,
} from '../wishTile'
import { money, num } from './shopFormat'
import { DisposalBadge, DisposalRibbon } from './DisposalRibbon'
import type { ShopDisposal, ShopItem } from '../types'

// The Shop's picture tiles (THEME.md §6.3 "Picture tiles"): the one layout of
// every picture view (the Wishlist, Owned's big pictures and its Gone fold),
// the picture well (and its row-sized square for Owned's compact rows), the
// history bar, the tile's fixed parts and the loading copy.

/**
 * One category's tiles, each subcategory a block named once above its own tiles — the one layout of every picture view.
 * Every tile is one size: two equal columns on a list under 40rem (a phone), else fixed 12rem tracks. The blocks are laid
 * in lines by `pictureLines` from the list's own width (measured before the first paint): a block shares a line only when
 * all its tiles fit in what is left, so no line has a hole, and a small block fills the end of an earlier line (two
 * one-tile subcategories share a phone's row). Before the measure, every block takes the whole width with the CSS grid
 * (`TILE_GRID`). Inside `PictureCategories` the list hands down the category's `layout` (its own columns).
 */
export function PictureBlocks({ id, subs, card, layout }: {
  id?: string
  subs: readonly { key: string; title: string | null; items: readonly ShopItem[] }[]
  card: (item: ShopItem) => ReactNode
  layout?: TileLayout
}) {
  const { ref, width } = useElementWidthRem()
  const labelled = subs.some(s => s.title)
  const counts = subs.map(s => s.items.length)
  const plan = layout ? { ...layout, lines: pictureLines(counts, layout.line) } : width == null ? null : tileBlocks(counts, width)
  const block = (sub: (typeof subs)[number]) => {
    const cols = plan ? pictureColumns(sub.items.length, plan.line) : 1
    // On a phone the columns share the box: `cols` of `line` equal columns and the gaps between them.
    const box: CSSProperties | undefined = plan == null ? undefined
      : plan.narrow ? { width: cols >= plan.line ? '100%' : `calc((100% - ${plan.line - 1} * ${TILE_GAP_REM}rem) * ${cols / plan.line} + ${cols - 1} * ${TILE_GAP_REM}rem)` }
        : { width: `${tilesRem(cols)}rem` }
    const grid: CSSProperties | undefined = plan == null ? undefined
      : { gridTemplateColumns: plan.narrow ? `repeat(${cols}, minmax(0, 1fr))` : `repeat(${cols}, ${TILE_REM}rem)` }
    return (
      <div key={sub.key} data-block className={cx('flex min-w-0 shrink-0 flex-col gap-1', plan == null && 'w-full')} style={box}>
        {labelled && <Truncate as="p" className="section-label px-1">{sub.title ?? 'Other'}</Truncate>}
        <ul className={plan == null ? TILE_GRID : 'grid items-start gap-2.5'} style={grid}>
          {sub.items.map(item => <li key={item.id} data-tile className="flex min-w-0 flex-col [&>*]:flex-1">{card(item)}</li>)}
        </ul>
      </div>
    )
  }
  return (
    <div ref={ref} id={id} className={TILE_LINES}>
      {plan == null
        ? subs.map(block)
        : plan.lines.map(line => <div key={subs[line[0]].key} data-line className={TILE_LINE}>{line.map(i => block(subs[i]))}</div>)}
    </div>
  )
}

/**
 * The categories of a picture view, packed like their blocks one level up (`categoryLines`): a category whose tiles fit in
 * one row is as wide as that row and shares a line with others that fit (first fit, each with its own header, total and
 * fold), so a small category never leaves the rest of the width empty; a category that needs more rows has the whole
 * width. From the list's own width, measured before the first paint; until then, one category under the other. `render`
 * draws item `i` with the layout its `PictureBlocks` gets.
 */
export function PictureCategories({ items, render }: {
  items: readonly { key: string; blocks: readonly number[] }[]
  render: (i: number, layout: TileLayout | undefined) => ReactNode
}) {
  const { ref, width } = useElementWidthRem()
  const narrow = width != null && width < TILE_NARROW_REM
  const line = width == null ? 0 : narrow ? 2 : tileColumns(width)
  const plan = width == null ? null : categoryLines(items.map(x => x.blocks), line)
  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-4">
      {plan == null ? items.map((x, i) => <div key={x.key}>{render(i, undefined)}</div>) : plan.lines.map(l => (
        <div key={items[l[0]].key} data-cat-line className={TILE_LINE}>
          {l.map(i => {
            const cols = plan.cols[i]
            const box: CSSProperties = cols == null || cols >= line ? { width: '100%' }
              : narrow ? { width: `calc((100% - ${TILE_GAP_REM}rem) / 2)` } : { width: `${tilesRem(cols)}rem` }
            return <div key={items[i].key} data-cat className="min-w-0 shrink-0" style={box}>{render(i, { narrow, line: cols ?? line })}</div>
          })}
        </div>
      ))}
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
 * A tile's parts under its title, each a fixed height whatever it holds, so every tile is one height (owner, 24.11.2026):
 * the price with where it was read (one line, the shop's address cut inside its link), the facts (one line, cut at the
 * end), the price history (its own line, shown whenever the tile has one), and the notes — why a check read no price, the
 * money a planned sale still leaves, the deal note — in two lines, cut at the end. A part with nothing keeps its room. Cut
 * text shows whole on hover and in a bubble on a tap (never a More that grows the tile), and all of it is in the record.
 */
export function TileLines({ price, meta, history, notes }: { price: ReactNode; meta: ReactNode; history?: ReactNode; notes?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-1.5 pb-2 pt-0.5">
      <span className="flex h-5 min-w-0 items-baseline gap-x-1 whitespace-nowrap text-meta text-fg-muted">{price}</span>
      <span className="flex h-4 min-w-0 items-center text-meta tabular-nums text-fg-muted">{meta}</span>
      <span className="flex h-4 min-w-0 items-center">{history}</span>
      <span className="flex h-8 min-w-0 items-start text-meta text-fg-muted">{notes}</span>
    </div>
  )
}

/** A tile's loading copy at the tile's own fixed size: the well, the two-line title, the four parts, the action row. */
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
        <span className="h-8" />
      </span>
      <span className={TILE_ACTIONS}><Skeleton className="h-9 w-full [@media(pointer:coarse)]:h-11" /></span>
    </div>
  )
}
