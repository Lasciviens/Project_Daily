import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { removeRowsFromCache } from '../../../shared/query/cachePatch'
import { createShopCategory } from '../api/shopApi'
import { removeNewCategory } from '../api/shopCategoryApi'
import type { ShopCategory } from '../types'

const byName = (a: ShopCategory, b: ShopCategory) => a.name.localeCompare(b.name, 'nb')

/**
 * A suggested category picked in a picker (shopTaxonomy): made at once
 * through the normal API — its row goes into the cached list from the
 * write's own answer — and the toast says so, "Headphones added under
 * Electronics · Undo". Nothing is ever added without a pick. Undo removes it
 * again (whatever was put in it since moves to its parent) and calls
 * `onUndone`, so a picker still showing it can step back.
 */
export function useAddSuggestedCategory() {
  const qc = useQueryClient()
  const create = useMutationWithFeedback({
    action:     'create_shop_category',
    silent:     'its Undo toast says what was added',
    mutationFn: ({ name, parent }: { name: string; parent: ShopCategory | null }) => createShopCategory({ name, parent_id: parent?.id ?? null }),
    onSuccess:  (row: ShopCategory) => {
      qc.setQueryData<ShopCategory[]>(qk.shop.categories(), rows => (rows && !rows.some(r => r.id === row.id) ? [...rows, row].sort(byName) : rows))
    },
    invalidates: [qk.shop.categories()],
  })
  const remove = useMutationWithFeedback({
    action:     'remove_new_shop_category',
    silent:     'the Undo of an added category: the picker shows it gone',
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => removeNewCategory(id, parentId),
    onMutate:   ({ id }) => removeRowsFromCache(qc, qk.shop.categories(), new Set([id])),
    invalidates: [qk.shop.categories(), qk.shop.items()],
  })

  /** Adds `name` (under `parent`, else as a top category); the new row, or null when the write failed (its hook said why). */
  async function add(name: string, parent: ShopCategory | null, onUndone?: (row: ShopCategory) => void): Promise<ShopCategory | null> {
    let row: ShopCategory
    try {
      row = await create.mutateAsync({ name, parent })
    } catch {
      return null
    }
    toast.undo(parent ? `${row.name} added under ${parent.name}` : `${row.name} added`, () => {
      onUndone?.(row)
      remove.mutate({ id: row.id, parentId: parent?.id ?? null })
    })
    return row
  }
  return { add, busy: create.isPending }
}
