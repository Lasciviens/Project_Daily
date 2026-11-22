import { useAddBatchToQuickList } from '../../shop/hooks/useQuickBatch'
import { toShopInput, type ToBuyRow } from '../toBuy'

/** "To buy → Shop": one tap puts a project table's To buy rows on the quick list (duplicates skipped, one Undo). */
export function useToBuyToShop() {
  const add = useAddBatchToQuickList()
  return {
    send: (rows: ToBuyRow[], projectName: string) => add.mutate({ inputs: rows.map(r => toShopInput(r, projectName)), what: projectName }),
    isPending: add.isPending,
  }
}
