// Where a detail pill's dropdown opens (PropertyPills). Pure and import-free
// so scripts/verify-dev-request-context.cjs can check it.

export interface AnchorRect { top: number; bottom: number; left: number }
export interface BoxSize { width: number; height: number }
export interface DropdownPlacement { top: number; left: number; maxHeight: number; above: boolean }

/** px: space between pill and list, distance kept from the screen edges, tallest list (20rem: seven options). */
export const DROPDOWN_SPACING = { gap: 4, margin: 8, cap: 320 } as const

/**
 * Fixed (viewport) coordinates for a dropdown at its pill: below when the
 * list fits there or there is at least as much room below as above, else
 * above. Its height is capped to `cap` and to the room on that side (the
 * rest scrolls); it moves left to stay on screen, never past the left margin.
 */
export function placeDropdown(anchor: AnchorRect, list: BoxSize, viewport: BoxSize, spacing: { gap: number; margin: number; cap: number } = DROPDOWN_SPACING): DropdownPlacement {
  const { gap, margin, cap } = spacing
  const want = Math.min(list.height, cap)
  const below = viewport.height - margin - (anchor.bottom + gap)
  const room = anchor.top - gap - margin
  const above = want > below && room > below
  const maxHeight = Math.max(0, Math.min(cap, above ? room : below))
  const height = Math.min(want, maxHeight)
  const top = above ? anchor.top - gap - height : anchor.bottom + gap
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - list.width))
  return { top, left, maxHeight, above }
}
