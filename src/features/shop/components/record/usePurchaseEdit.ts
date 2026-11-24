import { useState } from 'react'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useShopCategories } from '../../hooks/useShop'
import { useLawRules, useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { useSavePurchase } from '../../hooks/usePurchase'
import { inPlaceForm, purchaseFormOf, purchaseTouched, purchaseView, purchaseWrite, withReceiptOnForm, type PurchaseForm } from './purchaseDraft'
import type { ReceiptFill, ReceiptRead } from '../../../ai/claude/featureRules'
import type { ShopItem } from '../../types'

/**
 * A saved thing's purchase facts being edited in the one body — Just bought (mode bought) and the Purchase section's editor
 * (mode open, `inPlace`): the form, seeded from the row (a read receipt handed over from Read a receipt goes on it first),
 * and Save through `useSavePurchase` ("Purchase saved — return by … · Undo"), the same write as before (`purchaseWrite`).
 *
 * `inPlace`: the record's Facts own the day and the store (one editor each — guardian, 24.11.2026): the form always takes the
 * row's day and never writes a store, so a Facts edit is never written back stale; while the owner has changed nothing, the
 * form follows the row (a save elsewhere re-seeds it).
 */
export function usePurchaseEdit(item: ShopItem, receipt?: { fill: ReceiptFill; read: ReceiptRead }, { inPlace = false }: { inPlace?: boolean } = {}) {
  const today = todayStr()
  const { data: stores = [], isLoading: storesLoading } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  const { data: law = [] } = useLawRules()
  const { data: categories = [] } = useShopCategories()
  const save = useSavePurchase()
  const ctx = { stores, rules, law, categories, today }
  const seedOf = () => purchaseFormOf(item, ctx)
  const [seed, setSeed] = useState<PurchaseForm>(seedOf)
  const [form, setForm] = useState<PurchaseForm>(() => {
    // Opened from Read a receipt: the same path a receipt photo takes, once.
    return receipt ? withReceiptOnForm(seed, receipt.fill, receipt.read, seed.day, today) : seed
  })
  const dirty = purchaseTouched(form, seed) || (!!form.rd && form.rd !== seed.rd)
  // In place: a row changed elsewhere (a Facts save, a refetch) re-seeds the form while the owner has changed nothing in it
  // (worked out while rendering, React's way to follow a prop — no effect that renders twice).
  const stamp = `${item.updated_at}|${item.bought_at ?? ''}|${item.platform ?? ''}`
  const [seenStamp, setSeenStamp] = useState(stamp)
  if (inPlace && seenStamp !== stamp) {
    setSeenStamp(stamp)
    if (!dirty) {
      const next = purchaseFormOf(item, { categories, today })
      setSeed(next)
      setForm(next)
    }
  }
  const used: PurchaseForm = inPlace ? inPlaceForm(form, item, today) : form
  const view = purchaseView(item, used, ctx)
  function submit(onDone?: () => void) {
    const w = purchaseWrite(item, used, view)
    if (!w) return
    save.mutate({ id: item.id, patch: w.patch, done: w.done, costs: w.costs }, { onSuccess: () => onDone?.() })
  }
  return { form: used, setForm, view, stores, storesLoading, today, submit, saving: save.isPending, valid: view.valid, dirty }
}

export type PurchaseEditModel = ReturnType<typeof usePurchaseEdit>
