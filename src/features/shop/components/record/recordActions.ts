// The record's one row of actions never wraps (owner, 23.11.2026: "why didn't you make this one line?"). It used to be
// `flex-wrap`, with only the `more` actions hidden below a fixed 30rem of the whole record — but the row shares the
// record's width with the picture, so at the side pane's width (22rem) and on a phone "Sell or give away" +
// "Accessory" + ⋯ were wider than the row and the last one dropped to a second line. Now the row measures the room it
// really has (`useElementWidthRem` on its own box) and `fitActions` says which buttons fit; the rest go behind ⋯.
// Pure — scripts/verify-shop-record.cjs.

export interface FitAction { key: string; label: string; iconOnly?: boolean }

/** A small button's width in rem: padding and border, the icon, and the label at about half a rem a letter. */
const BUTTON_BASE = 2.9
const PER_LETTER = 0.56
/** An icon-only button is 36px (44 on touch: counted at 44). */
const ICON_BUTTON = 2.75
/** The gap between buttons. */
const GAP = 0.375

const widthOf = (a: FitAction) => (a.iconOnly ? ICON_BUTTON : BUTTON_BASE + a.label.length * PER_LETTER)

/**
 * Which actions show as buttons in `room` rem and which go behind ⋯, in the order given (the first is the primary
 * one and always shows). All of them when they fit; else the ⋯ button's room is kept and the buttons are taken in
 * order until the next one doesn't fit. `room` null (not measured yet): all of them.
 */
export function fitActions<T extends FitAction>(room: number | null, actions: readonly T[]): { shown: T[]; more: T[] } {
  if (room == null || actions.length === 0) return { shown: [...actions], more: [] }
  const total = actions.reduce((sum, a, i) => sum + widthOf(a) + (i > 0 ? GAP : 0), 0)
  if (total <= room) return { shown: [...actions], more: [] }
  const shown: T[] = []
  let used = ICON_BUTTON + GAP
  for (const a of actions) {
    const need = widthOf(a) + (shown.length > 0 ? GAP : 0)
    if (shown.length > 0 && used + need > room) break
    shown.push(a)
    used += need
  }
  return { shown, more: actions.slice(shown.length) }
}
