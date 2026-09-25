// Formatting and shared class strings for the Analytics components (a .tsx
// file may export only components).

/** Idle filter pills: faint in dark, plain in light — the header tabs' own recipe. */
export const TGA_IDLE_TAB = 'bg-[var(--tg-tab-idle-bg,color-mix(in_srgb,var(--tg-panel)_55%,transparent))]'

/** A card: the page's 18px panel, lifted slightly off the canvas. */
export const TGA_CARD = 'tg-panel min-w-0 shadow-[shadow:var(--tg-shadow)]'

/** 44px rows on touch, a denser 34px where a mouse can aim. */
export const TGA_ROW_H = 'min-h-[34px] [@media(pointer:coarse)]:min-h-[44px]'

export const fmtInt = (n: number) => n.toLocaleString('en-GB')

export function fmtPct(part: number, whole: number): string {
  if (!whole || !part) return '0%'
  const p = (part / whole) * 100
  if (p < 1) return '<1%'
  return `${Math.round(p)}%`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`

// ─── Card grid ───────────────────────────────────────────────────────────────
// Container widths, not the viewport: phone 1 column, tablet 2, laptop 3,
// monitor 4. The spans and one reorder pair cards of similar height per row:
//   2 cols  [Completions ··] [Status · Ratings] [Most played · Platforms] [Genres · Recent]
//   3 cols  [Completions ·· · Status] [Most played · Platforms · Genres] [Recent ·· · Ratings]
//   4 cols  [Completions ·· · Status · Ratings] [Most played · Platforms · Genres · Recent]
export const TGA_GRID = 'grid grid-cols-1 gap-4 @2xl:grid-cols-2 @[62rem]:grid-cols-3 @[62rem]:gap-5 @[100rem]:grid-cols-4'
export const TGA_SPAN_WIDE = '@2xl:col-span-2'
export const TGA_SPAN_RECENT = '@[62rem]:col-span-2 @[100rem]:col-span-1'
export const TGA_ORDER_RATINGS = '@[62rem]:order-last @[100rem]:order-none'

/** "Nothing played in the last 30 days" — the window as a phrase. */
export const TGA_RANGE: Record<'all' | '12m' | 'year' | '30d', string> = {
  all: 'in the last 24 months', '12m': 'in the last 12 months', year: 'this year', '30d': 'in the last 30 days',
}
