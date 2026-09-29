import { useBoardStep } from '../../../shared/ui'

/**
 * Where a glance tile opens its detail. On a phone or tablet (a one-column
 * Home) a page tile goes straight to its page; on a wide Home, where the
 * tiles stand in for the full widgets, it opens that widget's content in a
 * popup (TileDetail) — the owner's call for the laptop, so nothing the
 * widgets showed there becomes unreachable.
 */
export function useTilePopup(): boolean {
  return useBoardStep() >= 2
}
