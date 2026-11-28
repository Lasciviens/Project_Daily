// How tall a field's suggestion list may be (FieldOptions.tsx), kept pure for verify-item-screen. Owner, 27.11.2026:
// the Movie search's list opened above its field on the iPhone, over the title and the Category row, its top under the
// status bar. The list belongs under its field, sized to what the keyboard leaves of the screen; only when even a few
// rows don't fit there may it go above — and then never into the status bar (the top safe area).

/** A list's tallest (Tailwind max-h-72) and the least worth keeping under the field (three rows) — px. */
export const OPTIONS_CAP = 288
export const OPTIONS_FLOOR = 144
/** Kept clear of the visible area's edges (Headless UI's anchor padding). */
export const OPTIONS_MARGIN = 12
/** A few pixels short of the room, so sub-pixel rounding never makes Floating UI think it doesn't fit (and flip it). */
const SLACK = 4

export interface FieldBox { top: number; bottom: number }
/** The visible part of the screen in the field's own coordinates (above the keyboard), and the status bar's height. */
export interface Visible { top: number; bottom: number; safeTop: number }

/**
 * The list's max height: the room under the field when at least OPTIONS_FLOOR fits there — Floating UI then keeps it
 * there (it fits, so it never flips); else the larger of the two sides, the room above measured from under the status
 * bar, so a list that does flip stops at the safe area.
 */
export function optionsMaxHeight(field: FieldBox, visible: Visible, gap: number): number {
  const below = visible.bottom - OPTIONS_MARGIN - (field.bottom + gap) - SLACK
  const above = field.top - gap - Math.max(visible.top + OPTIONS_MARGIN, visible.safeTop + OPTIONS_MARGIN) - SLACK
  const room = below >= OPTIONS_FLOOR ? below : Math.max(below, above)
  return Math.floor(Math.max(0, Math.min(OPTIONS_CAP, room)))
}

/**
 * How far to scroll the field up so its list fits under it — `want` px of it (the list's own height when known, a
 * select's few choices), at least OPTIONS_FLOOR and at most OPTIONS_CAP — 0 when it already does: the field moves up,
 * never past the top of the visible area (under the status bar). The list then opens under its field even on the
 * smallest phone with the keyboard up, instead of flipping over the rows above it.
 */
export function optionsLift(field: FieldBox, visible: Visible, gap: number, want: number = OPTIONS_FLOOR): number {
  const height = Math.min(OPTIONS_CAP, Math.max(OPTIONS_FLOOR, want))
  const need = field.bottom + gap + height + OPTIONS_MARGIN + SLACK - visible.bottom
  const most = field.top - Math.max(visible.top, visible.safeTop) - OPTIONS_MARGIN
  return Math.max(0, Math.ceil(Math.min(need, most)))
}
