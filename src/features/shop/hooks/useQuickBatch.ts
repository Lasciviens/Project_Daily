import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { removeRowsFromCache } from '../../../shared/query/cachePatch'
import { addBatchToQuickList, removeBatch, type QuickBatchResult } from '../api/quickBatchApi'
import { batchWords } from '../quickBatch'
import { SHOP_ROWS } from './useShop'
import type { CreateShopItemInput, ShopItem } from '../types'

/**
 * Several rows onto the quick list in one tap ("Added 6 items to the quick list
 * · Week 48 · 2 already there · Undo"). Things already on the list are left
 * out; ONE Undo takes the whole add off again. `what` names the source.
 */
export function useAddBatchToQuickList() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_batch_add',
    successMessage: (_d: void, rows: ShopItem[]) => `Taken off the quick list · ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`,
    mutationFn:     (rows: ShopItem[]) => removeBatch(rows),
    onSuccess:      (_d, rows) => removeRowsFromCache(qc, qk.shop.items(), new Set(rows.map(r => r.id))),
    invalidates:    SHOP_ROWS,
  })
  return useMutationWithFeedback({
    action:      'shop_batch_add',
    silent:      'its toast with Undo reports the result',
    mutationFn:  ({ inputs }: { inputs: CreateShopItemInput[]; what: string }): Promise<QuickBatchResult> => addBatchToQuickList(inputs),
    onSuccess:   (r, { what }) => {
      if (r.added.length === 0) { toast.info('Everything is already on the quick list'); return }
      qc.setQueryData<ShopItem[]>(qk.shop.items(), rows => (rows ? [...rows, ...r.added.filter(a => !rows.some(x => x.id === a.id))] : rows))
      toast.undo(batchWords(r.added.length, r.skipped, what), () => undo.mutate(r.added))
    },
    invalidates: [qk.shop.items()],
  })
}
