import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../../../app/store'
import { newShopId } from '../../api/shopApi'
import {
  addStep, COPIED, hasContent, newDraft, parseDraft, removeStep, restoreStep, setCopy,
  type ChainDraft, type Copied, type DraftStep,
} from '../../chainDraft'
import type { ShopCurrency } from '../../types'

// The chain being built, kept on this device until it is saved or thrown
// away (a reload, a crash or a closed tab never loses it). Every access is
// guarded: blocked storage simply keeps it for this visit.
// One slot for a new chain and one per saved thing a chain goes on from.
const KEY = (fromId: string | null) => (fromId ? `lasci.shop.chainDraft.${fromId}` : 'lasci.shop.chainDraft')

function read(fromId: string | null): ChainDraft | null {
  try {
    const raw = localStorage.getItem(KEY(fromId))
    const d = raw ? parseDraft(JSON.parse(raw)) : null
    return d && d.fromId === fromId && hasContent(d) ? d : null
  } catch { return null }
}

function write(fromId: string | null, d: ChainDraft | null) {
  try {
    if (d && hasContent(d)) localStorage.setItem(KEY(fromId), JSON.stringify(d))
    else localStorage.removeItem(KEY(fromId))
  } catch { /* storage unavailable: kept for this visit */ }
}

/** `currency`: the first step's to start with (going on from a sale: the sale's). */
export function useChainDraft(fromId: string | null, base: Copied | null, currency: ShopCurrency = 'NOK') {
  const [restored] = useState(() => read(fromId))
  const [draft, setDraft] = useState<ChainDraft>(() => restored ?? newDraft(newShopId(), fromId, currency))
  const [showRestored, setShowRestored] = useState(!!restored)
  const [open, setOpen] = useState<Set<string>>(() => new Set(restored ? [] : [draft.steps[0].key]))

  useEffect(() => { write(fromId, draft) }, [fromId, draft])

  /** A change to a copied fact makes the step's facts its own first (editing it is the answer to "copy?"). */
  const update = useCallback((index: number, patch: Partial<DraftStep>) => setDraft(d => {
    const step = d.steps[index]
    if (!step) return d
    const own = step.copyPrev && COPIED.some(k => k in patch) ? setCopy(d, index, false, base) : d
    return { ...own, steps: own.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
  }), [base])

  const copy = useCallback((index: number, on: boolean) => setDraft(d => setCopy(d, index, on, base)), [base])

  function add() {
    const key = newShopId()
    const prev = draft.steps[draft.steps.length - 1]
    // The one before stays open while its sale still needs a day.
    setOpen(new Set([key, ...(!prev.leftOn ? [prev.key] : [])]))
    setDraft(addStep(draft, key))
  }

  function remove(index: number) {
    const { draft: next, removed } = removeStep(draft, index)
    if (!removed) return
    setDraft(next)
    toast.undo(`Removed ${removed.step.title.trim() || 'a step'}`, () => setDraft(cur => restoreStep(cur, removed)))
  }

  const toggle = useCallback((key: string) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n }), [])
  const openAll = useCallback((keys: string[]) => setOpen(s => new Set([...s, ...keys])), [])

  const startOver = useCallback(() => {
    const d = newDraft(newShopId(), fromId, currency)
    setDraft(d)
    setOpen(new Set([d.steps[0].key]))
    setShowRestored(false)
  }, [fromId, currency])

  /** Saved or thrown away: nothing kept. */
  const forget = useCallback(() => write(fromId, null), [fromId])

  return {
    draft, setName: (name: string) => setDraft(d => ({ ...d, name })), update, copy, add, remove,
    open, toggle, openAll, restored: showRestored, dismissRestored: () => setShowRestored(false), startOver, forget,
  }
}
