import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { putRowsInCache } from '../../../shared/query/cachePatch'
import { todayStr } from '../../../shared/utils/dateUtils'
import { updateShopItem } from '../api/shopApi'
import { updateChecklist } from '../api/shopResaleApi'
import { parseTickBook, ticksOf, valueBefore, valuesSavedWords, withTicks, type TickBook, type ValueUpdate } from '../sellingModel'
import type { ShopHandoverChecklist } from '../resaleTypes'
import type { ShopItem, UpdateShopItemInput } from '../types'

// The selling screens' writes beyond 192's data layer (useShopResale.ts): "Update values" for many estimates at
// once, a checklist's steps edited with Undo, and the hand-over ticks on this device.

type ValueRow = Pick<ShopItem, 'id' | 'title' | 'value_now' | 'value_currency' | 'value_on'>
interface ValuesVars { rows: { item: ValueRow; next: ValueUpdate }[] }
interface ValuesAnswer { saved: ShopItem[]; before: ReturnType<typeof valueBefore>[]; failed: { title: string; message: string } | null }

async function writeValues(rows: { id: string; patch: UpdateShopItemInput; title: string }[]): Promise<{ saved: ShopItem[]; failed: ValuesAnswer['failed'] }> {
  const saved: ShopItem[] = []
  for (const r of rows) {
    try {
      saved.push(await updateShopItem(r.id, r.patch))
    } catch (e) {
      return { saved, failed: { title: r.title, message: (e as Error).message } }
    }
  }
  return { saved, failed: null }
}

/**
 * "Update values": every changed estimate saved with its day, one after another (the database keeps each in the
 * value history). "3 estimates updated · Undo" — Undo puts each back as it was, which takes back the history rows
 * of that day too (192). A row that fails stops the rest and says which; the ones saved keep their Undo.
 */
export function useUpdateValues() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_update_values',
    successMessage: (a: { saved: ShopItem[] }) => `${valuesSavedWords(a.saved.length)} — undone`,
    mutationFn:     async (before: ValuesAnswer['before']) => {
      const out = await writeValues(before.map(b => ({ id: b.id, title: '', patch: { value_now: b.value_now, value_currency: b.value_currency, value_on: b.value_on } as UpdateShopItemInput })))
      if (out.failed) throw new Error(out.failed.message)
      return out
    },
    onSuccess:      (a: { saved: ShopItem[] }) => putRowsInCache(qc, qk.shop.items(), a.saved),
    invalidates:    [qk.shop.items()],
  })
  return useMutationWithFeedback({
    action:      'shop_update_values',
    silent:      'its own toast says how many, with Undo',
    mutationFn:  async ({ rows }: ValuesVars): Promise<ValuesAnswer> => {
      const out = await writeValues(rows.map(({ item, next }) => ({
        id: item.id, title: item.title,
        patch: { value_now: next.value_now, value_currency: next.value_currency, value_on: next.value_on } as UpdateShopItemInput,
      })))
      const savedIds = new Set(out.saved.map(s => s.id))
      return { ...out, before: rows.filter(r => savedIds.has(r.item.id)).map(r => valueBefore(r.item)) }
    },
    onSuccess:   (a: ValuesAnswer) => {
      putRowsInCache(qc, qk.shop.items(), a.saved)
      if (a.saved.length) toast.undo(valuesSavedWords(a.saved.length), () => undo.mutate(a.before))
      if (a.failed) toast.error(`${a.failed.title} wasn't saved: ${a.failed.message}`)
    },
    invalidates: [qk.shop.items()],
  })
}

/** A checklist's steps saved: "Checklist saved · Undo" (Undo writes the steps back as they were). */
export function useEditChecklist() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_checklist_edit',
    successMessage: 'Checklist put back',
    mutationFn:     ({ id, steps }: { id: string; steps: string }) => updateChecklist(id, { steps }),
    onSuccess:      (c: ShopHandoverChecklist) => putRowsInCache(qc, qk.shop.handovers(), [c]),
    invalidates:    [qk.shop.handovers()],
  })
  return useMutationWithFeedback({
    action:      'edit_shop_handover_checklist',
    silent:      'its own toast reports it with Undo',
    mutationFn:  ({ checklist, steps }: { checklist: ShopHandoverChecklist; steps: string }) => updateChecklist(checklist.id, { steps }),
    onSuccess:   (c: ShopHandoverChecklist, v: { checklist: ShopHandoverChecklist; steps: string }) => {
      putRowsInCache(qc, qk.shop.handovers(), [c])
      toast.undo(`Checklist saved · ${c.category}`, () => undo.mutate({ id: c.id, steps: v.checklist.steps }))
    },
    invalidates: [qk.shop.handovers()],
  })
}

/**
 * Which hand-over steps are ticked for a thing, on this device (a tick is a moment's note while handing it over;
 * the database keeps the steps, not the ticks). By the step's words, the last 20 things; sign-out clears it
 * (src/security/accountState.ts).
 */
export const HANDOVER_TICKS_KEY = 'lasci.shop.handover'

function readBook(): TickBook {
  try { return parseTickBook(JSON.parse(localStorage.getItem(HANDOVER_TICKS_KEY) ?? 'null')) } catch { return {} }
}

export function useHandoverTicks(itemId: string, steps: readonly string[]) {
  const [book, setBook] = useState<TickBook>(readBook)
  const ticked = useMemo(() => ticksOf(book, itemId, steps), [book, itemId, steps])
  const toggle = useCallback((step: string) => setBook(b => {
    const now = ticksOf(b, itemId, steps)
    if (now.has(step)) now.delete(step); else now.add(step)
    const next = withTicks(b, itemId, [...now], todayStr())
    try { localStorage.setItem(HANDOVER_TICKS_KEY, JSON.stringify(next)) } catch { /* storage unavailable: kept while it is open */ }
    return next
  }), [itemId, steps])
  return { ticked, toggle }
}
