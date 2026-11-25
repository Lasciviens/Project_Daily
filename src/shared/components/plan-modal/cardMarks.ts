// A card's marks (owner, 24.11.2026: "Use them as banner instead"): the rows of one item-screen card report where
// their fields go, and the card (ItemRows.Section) draws them once, as its banner (FieldMark.CardBanner). Contexts and
// the hook live here, apart from the components (React's fast refresh wants a components-only file).

import { createContext, useCallback, useMemo, useState } from 'react'
import type { FieldGoes } from './itemScreenRules'

/** One row's mark in a card: where its field goes, and the row's name (its label) when the row has one. */
export interface CardMark { goes: FieldGoes; row: string | null }
/** A row's mark reports itself (a mark) or leaves (null), by its own id. */
export type RegisterMark = (id: string, mark: CardMark | null) => void

/** The card a mark sits in; none outside a card (the mark then draws in its row). */
export const CardContext = createContext<RegisterMark | null>(null)
/** The row a mark sits in (the label's text), so the card's words can name it. */
export const MarkRowContext = createContext<string | null>(null)

/** A card's marks as its rows report them, in row order (a row that changes keeps its place). */
export function useCardMarks(): { marks: CardMark[]; register: RegisterMark } {
  const [byId, setById] = useState<ReadonlyMap<string, CardMark>>(() => new Map())
  const register = useCallback<RegisterMark>((id, mark) => setById(prev => {
    const cur = prev.get(id)
    if (mark ? cur?.goes === mark.goes && cur.row === mark.row : !cur) return prev
    const next = new Map(prev)
    if (mark) next.set(id, mark)
    else next.delete(id)
    return next
  }), [])
  const marks = useMemo(() => [...byId.values()], [byId])
  return { marks, register }
}
