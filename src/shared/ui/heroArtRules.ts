/**
 * Header art (THEME.md §6.5, owner 12.10.2026: "a background image on the top
 * for every page — a related image"): a still drawing of the page's subject,
 * in the theme's own colours, dimmed and faded out on its left so the
 * controls near it stay readable. No network, no timers, no motion; the same
 * rules on every page, at every width and in both themes. Games has its own
 * look and none.
 *
 * This file holds the pure parts — the canvas, the colours a motif may use
 * and where the art sits in its band (scripts/verify-hero-art.cjs); the layer
 * and the band are PageHeroArt.tsx, the measuring useHeroArt.ts.
 *
 * A page passes only its motif: SVG content drawn on the 640 × 140 canvas
 * with the `HERO` classes. The art is as tall as its host (at most 6.5rem)
 * and fades in over its left 40 %, so a motif keeps its subject in the
 * right half of the canvas.
 */
export const HERO_ART_VIEWBOX = '0 0 640 140'

/** The only colours a motif uses: the accent, the muted ink, and the card surface for "holes". */
export const HERO = {
  accent: 'fill-accent-500',
  muted: 'fill-fg-muted',
  hole: 'fill-surface',
  accentLine: 'stroke-accent-500',
  mutedLine: 'stroke-fg-muted',
  holeLine: 'stroke-surface',
} as const

/** A sideways-scrolling strip inside the band runs to the band's edges (its padding is p-3). */
export const HERO_BAND_BLEED = '-mx-3 px-3'

/** A horizontal stretch [left, right] in px. */
export type Span = readonly [number, number]

/** Where the art sits in its band, as distances (px) from the band's edges: the art's
 *  right edge from the band's right, and where its clip starts from the band's left. */
export type HeroArtPlace = { left: number; right: number }

/**
 * The art goes into the right-most free stretch of the band that is at least
 * `minPx` wide (keeping `gapPx` of air from the controls on either side), so
 * a button, a switcher or a line of text never sits on it: the art ends at
 * the stretch's right and anything of it reaching past the stretch's left is
 * cut off there (the layer fades it out). Null when no stretch is wide
 * enough (a phone, where the controls fill the band): the art then sits
 * behind the controls.
 *
 * `band` is the band's own stretch (the art layer's box); `boxes` are the
 * stretches the controls and texts take (any order, may overlap or run past
 * the band).
 */
export function heroArtPlace(band: Span, boxes: readonly Span[], minPx: number, gapPx: number): HeroArtPlace | null {
  const [left, right] = band
  const taken = boxes
    .map(([a, b]) => [Math.max(left, a), Math.min(right, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of taken) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  // Free stretches from the right: after the last box, then between boxes, then before the first.
  for (let i = merged.length; i >= 0; i--) {
    const freeLeft = i === 0 ? left : merged[i - 1][1] + gapPx
    const freeRight = i === merged.length ? right : merged[i][0] - gapPx
    if (freeRight - freeLeft >= minPx) return { left: freeLeft - left, right: right - freeRight }
  }
  return null
}
