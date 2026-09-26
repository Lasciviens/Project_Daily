import { formatPlaytime } from '../../api/playtimeFormat'

// Formatting and shared class strings for the Analytics components (a .tsx
// file may export only components).

/** Idle filter pills: faint in dark, plain in light — the header tabs' own recipe. */
export const TGA_IDLE_TAB = 'bg-[var(--tg-tab-idle-bg,color-mix(in_srgb,var(--tg-panel)_55%,transparent))]'

/** A card: the page's 18px panel, lifted slightly off the canvas. */
export const TGA_CARD = 'tg-panel min-w-0 shadow-[shadow:var(--tg-shadow)]'

/**
 * The "rest of the bar" tone of a two-tone bar (no recorded play, missing…).
 * The 1px inner edge keeps it visible against the card (the plain tint read
 * about 1.3:1); the count next to every bar carries the value anyway.
 */
export const TGA_TINT = 'bg-[color-mix(in_srgb,var(--tg-accent)_30%,var(--tg-panel))] shadow-[shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--tg-accent)_45%,transparent)]'

/** 44px rows on touch, a denser 34px where a mouse can aim. */
export const TGA_ROW_H = 'min-h-[34px] [@media(pointer:coarse)]:min-h-[44px]'

export const fmtInt = (n: number) => n.toLocaleString('en-GB')

/** A share that never rounds away its extremes: 1 of 250 is "<1%", 249 of 250 is ">99%", only all of it is "100%". */
export function fmtPct(part: number, whole: number): string {
  if (!whole || part <= 0) return '0%'
  if (part >= whole) return '100%'
  const p = (part / whole) * 100
  if (p < 1) return '<1%'
  return p > 99 && Math.round(p) >= 100 ? '>99%' : `${Math.round(p)}%`
}

/**
 * The Playtime tile's headline: from a day up, whole hours ("14d 18h") so a
 * three-digit day total still fits a phone tile; the exact figure stays in
 * its accessible name and the drill-down.
 */
export function kpiPlaytime(seconds: number): string {
  if (seconds < 86_400) return formatPlaytime(seconds / 60)
  return formatPlaytime(Math.round(seconds / 3600) * 60)
}

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`

// ─── Card grid ───────────────────────────────────────────────────────────────
// Container widths, not the viewport: phone 1 column, tablet 2, laptop 3,
// monitor 4. Each tab places its own cards (spans, reorders) so rows pair
// cards of similar height.
export const TGA_GRID = 'grid grid-cols-1 gap-4 @2xl:grid-cols-2 @[62rem]:grid-cols-3 @[62rem]:gap-5 @[100rem]:grid-cols-4'
export const TGA_SPAN_WIDE = '@2xl:col-span-2'
/** The same grid capped at three columns, for a tab with only three cards to a row (Play without Trophies). */
export const TGA_GRID_3 = 'grid grid-cols-1 gap-4 @2xl:grid-cols-2 @[62rem]:grid-cols-3 @[62rem]:gap-5'

/** "Nothing played in the last 30 days" — the window as a phrase. */
export const TGA_RANGE: Record<'all' | '12m' | 'year' | '90d' | '30d' | '7d', string> = {
  all: 'in the last 24 months', '12m': 'in the last 12 months', year: 'this year',
  '90d': 'in the last 90 days', '30d': 'in the last 30 days', '7d': 'in the last 7 days',
}

/** The same range for a narrow card's header: "24 mo", "90 d". */
export const TGA_RANGE_SHORT: Record<keyof typeof TGA_RANGE, string> = {
  all: '24 mo', '12m': '12 mo', year: 'this year', '90d': '90 d', '30d': '30 d', '7d': '7 d',
}
