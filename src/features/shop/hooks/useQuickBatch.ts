import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { removeRowsFromCache } from '../../../shared/query/cachePatch'
import type { QuickBatchResult } from '../api/quickBatchApi'
import { batchWords } from '../quickBatchWords'
import type { CreateShopItemInput, ShopItem } from '../types'

/** What to add: the rows, or a `prepare` step that makes them (a category lookup) inside the same mutation, so one failure is one toast. */
export interface QuickBatchInput {
  inputs?:  CreateShopItemInput[]
  prepare?: () => Promise<CreateShopItemInput[]>
  /** The source, named in the toast ("Week 48", a recipe's title). */
  what:     string
  /** Runs after the add with the rows made (a source that marks them as sent). Its undo runs on Undo. */
  afterAdd?: (added: ShopItem[]) => Promise<(() => Promise<void>) | void>
}

/**
 * Several rows onto the quick list in one tap ("Added 6 items to the quick list
 * · Week 48 · 2 already there · Undo"). Things already on the list are left
 * out; ONE Undo takes the whole add off again.
 */
export function useAddBatchToQuickList() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_batch_add',
    successMessage: (_d: void, v: { rows: ShopItem[] }) => `Taken off the quick list · ${v.rows.length} ${v.rows.length === 1 ? 'item' : 'items'}`,
    mutationFn:     async ({ rows, back }: { rows: ShopItem[]; back?: (() => Promise<void>) | void }) => {
      // Loaded when used: Shop's api stays out of the page chunk of the screen that offers the button.
      await (await import('../api/quickBatchApi')).removeBatch(rows)
      if (back) await back()
    },
    onSuccess:      (_d, v) => removeRowsFromCache(qc, qk.shop.items(), new Set(v.rows.map(r => r.id))),
    invalidates:    [qk.shop.items(), qk.shop.quick()],
  })
  return useMutationWithFeedback({
    action:      'shop_batch_add',
    silent:      'its toast with Undo reports the result',
    mutationFn:  async (v: QuickBatchInput): Promise<QuickBatchResult & { back?: (() => Promise<void>) | void }> => {
      const inputs = v.prepare ? await v.prepare() : v.inputs ?? []
      const r = await (await import('../api/quickBatchApi')).addBatchToQuickList(inputs)
      const back = r.added.length && v.afterAdd ? await v.afterAdd(r.added) : undefined
      return { ...r, back }
    },
    onSuccess:   (r, { what }) => {
      if (r.added.length === 0) { toast.info('Everything is already on the quick list'); return }
      qc.setQueryData<ShopItem[]>(qk.shop.items(), rows => (rows ? [...rows, ...r.added.filter(a => !rows.some(x => x.id === a.id))] : rows))
      toast.undo(batchWords(r.added.length, r.skipped, what), () => undo.mutate({ rows: r.added, back: r.back }))
    },
    // A prepare step may have made Groceries / Recipe Ingredients: the category list is read again.
    invalidates: [qk.shop.items(), qk.shop.quick(), qk.shop.categories()],
  })
}
