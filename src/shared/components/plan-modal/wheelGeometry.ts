// The time wheel's arithmetic (TimeWheel.tsx), kept pure so verify-item-screen can check it: which row sits in the
// band at a scroll offset, and the offset that puts a row there. Every length is measured from the column as drawn
// (the owner's screenshot, 27.11.2026: 18 : 20 in the band for 14:15, the bold row above it — what a 32px constant
// against 2rem rows gives at Display scale 80 %, as the harness shows) — never a pixel constant, so any Display scale
// or a zoomed page keeps the value, the band and the bold row together.

export interface WheelGeometry {
  /** The first row's top inside the column's scroll content (the spacer above it). */
  first: number
  /** One row's height. */
  row: number
  /** The column's visible height (the band sits in its middle). */
  view: number
}

/** The scroll offset that centres row `i` in the column (the band). */
export function wheelTopOf(i: number, g: WheelGeometry): number {
  return Math.max(0, g.first + i * g.row + g.row / 2 - g.view / 2)
}

/** The row whose middle is nearest the column's middle at `scrollTop`, within 0…count-1. */
export function wheelIndexAt(scrollTop: number, g: WheelGeometry, count: number): number {
  if (!(g.row > 0)) return 0
  const i = Math.round((scrollTop + g.view / 2 - g.first - g.row / 2) / g.row)
  return Math.min(count - 1, Math.max(0, i))
}
