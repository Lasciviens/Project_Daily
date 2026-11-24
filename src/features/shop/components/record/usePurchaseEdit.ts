import { useState } from 'react'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useShopCategories } from '../../hooks/useShop'
import { useLawRules, useShopStores, useStoreRules } from '../../hooks/useShopStores'
import { useSavePurchase } from '../../hooks/usePurchase'
import { purchaseFormOf, purchaseView, purchaseWrite, withReceiptOnForm, type PurchaseForm } from './purchaseDraft'
import type { ReceiptFill, ReceiptRead } from '../../../ai/claude/featureRules'
import type { ShopItem } from '../../types'

/**
 * A saved thing's purchase facts being edited in the one body — Just bought (mode bought) and the Purchase section's editor
 * (mode open): the form, seeded once from the row (a read receipt handed over from Read a receipt goes on it first), and Save
 * through `useSavePurchase` ("Purchase saved — return by … · Undo"), the same write as before (`purchaseWrite`).
 */
export function usePurchaseEdit(item: ShopItem, receipt?: { fill: ReceiptFill; read: ReceiptRead }) {
  const today = todayStr()
  const { data: stores = [], isLoading: storesLoading } = useShopStores()
  const { data: rules = [] } = useStoreRules()
  const { data: law = [] } = useLawRules()
  const { data: categories = [] } = useShopCategories()
  const save = useSavePurchase()
  const ctx = { stores, rules, law, categories, today }
  const [form, setForm] = useState<PurchaseForm>(() => {
    const f = purchaseFormOf(item, ctx)
    // Opened from Read a receipt: the same path a receipt photo takes, once.
    return receipt ? withReceiptOnForm(f, receipt.fill, receipt.read, f.day, today) : f
  })
  const view = purchaseView(item, form, ctx)
  function submit(onDone?: () => void) {
    const w = purchaseWrite(item, form, view)
    if (!w) return
    save.mutate({ id: item.id, patch: w.patch, done: w.done, costs: w.costs }, { onSuccess: () => onDone?.() })
  }
  return { form, setForm, view, stores, storesLoading, today, submit, saving: save.isPending, valid: view.valid }
}

export type PurchaseEditModel = ReturnType<typeof usePurchaseEdit>
