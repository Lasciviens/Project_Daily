import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { removeRowsFromCache } from '../../../shared/query/cachePatch'
import { createShopCategory } from '../api/shopApi'
import { removeNewCategory, type RemovedCategory } from '../api/shopCategoryApi'
import { SUGGESTED, isPendingCategory, isSuggested, pickOf, type CategoryPick } from '../shopModel'
import { categoryKey } from '../shopTaxonomy'
import type { ShopCategory } from '../types'

const byName = (a: ShopCategory, b: ShopCategory) => a.name.localeCompare(b.name, 'nb')
const plural = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`

interface RemoveVars { row: ShopCategory; parent: ShopCategory | null }

/** "Headphones removed · 1 thing moved to Electronics" — or "· 2 things have no category now" for a top. */
export function removedWords({ row, parent }: RemoveVars, r: RemovedCategory): string {
  if (!r.gone) return `${row.name} was already gone`
  if (!r.moved) return `${row.name} removed`
  return parent ? `${row.name} removed · ${plural(r.moved)} moved to ${parent.name}` : `${row.name} removed · ${plural(r.moved)} ${r.moved === 1 ? 'has' : 'have'} no category now`
}

/**
 * The categories a picker's pick suggests (shopTaxonomy), made when the sheet is saved — the way "+ New
 * category…" is: `resolve` makes the suggested top, then the suggested subcategory, through the normal API
 * (each row goes into the cached list from the write's own answer; one the owner has by now is reused, never
 * made twice), and answers the category id to save. Its toast says what was made, "Headphones added under
 * Electronics · Undo"; Undo removes it again — whatever was saved in it moves to its parent — and says so
 * ("Headphones removed · 1 thing moved to Electronics"). It never touches a sheet's draft: the save is done.
 */
export function useResolveCategory() {
  const qc = useQueryClient()
  const create = useMutationWithFeedback({
    action:     'create_shop_category',
    silent:     'a step of the sheet\'s save; its Undo toast says what was added',
    mutationFn: ({ name, parent }: { name: string; parent: ShopCategory | null }) => createShopCategory({ name, parent_id: parent?.id ?? null }),
    onSuccess:  (row: ShopCategory) => {
      qc.setQueryData<ShopCategory[]>(qk.shop.categories(), rows => (rows && !rows.some(r => r.id === row.id) ? [...rows, row].sort(byName) : rows))
    },
    invalidates: [qk.shop.categories()],
  })
  const remove = useMutationWithFeedback({
    action:         'remove_new_shop_category',
    successMessage: (r: RemovedCategory, v: RemoveVars) => removedWords(v, r),
    mutationFn:     ({ row, parent }: RemoveVars) => removeNewCategory(row.id, parent?.id ?? null, row.created_at),
    onSuccess:      (_: RemovedCategory, { row }: RemoveVars) => removeRowsFromCache(qc, qk.shop.categories(), new Set([row.id])),
    invalidates:    [qk.shop.categories(), qk.shop.items()],
  })

  /** The owner's own category of this name (any case, "&" or "and") under `parentId`, made by now. */
  const existing = (name: string, parentId: string | null): ShopCategory | undefined =>
    (qc.getQueryData<ShopCategory[]>(qk.shop.categories()) ?? [])
      .find(c => (c.parent_id ?? null) === parentId && categoryKey(c.name) === categoryKey(name))

  /**
   * The id to save for a pick (or a single id that may be a pending one): suggestions made first. Throws when a
   * write fails (its hook said why), so the sheet's save stops there.
   */
  async function resolve(pickOrId: CategoryPick | string | null, categories: readonly ShopCategory[]): Promise<string | null> {
    if (pickOrId == null) return null
    if (typeof pickOrId === 'string' && !isPendingCategory(pickOrId)) return pickOrId
    const pick = typeof pickOrId === 'string' ? pickOf(pickOrId, categories) : pickOrId
    if (!isSuggested(pick.topId) && !isSuggested(pick.subId)) return pick.subId || pick.topId || null
    let made: RemoveVars | null = null
    let top: ShopCategory | null = categories.find(c => c.id === pick.topId) ?? null
    if (isSuggested(pick.topId)) {
      const name = pick.topId.slice(SUGGESTED.length)
      top = existing(name, null) ?? null
      if (!top) { top = await create.mutateAsync({ name, parent: null }); made = { row: top, parent: null } }
    }
    if (!top) return null
    let id = pick.subId && !isSuggested(pick.subId) ? pick.subId : top.id
    if (isSuggested(pick.subId)) {
      const name = pick.subId.slice(SUGGESTED.length)
      let sub = existing(name, top.id)
      if (!sub) { sub = await create.mutateAsync({ name, parent: top }); made ??= { row: sub, parent: top } }
      id = sub.id
    }
    if (made) {
      const vars = made
      const sub = id !== top.id ? (qc.getQueryData<ShopCategory[]>(qk.shop.categories()) ?? []).find(c => c.id === id) : null
      const words = vars.parent ? `${vars.row.name} added under ${vars.parent.name}` : sub ? `${vars.row.name} and ${sub.name} added` : `${vars.row.name} added`
      toast.undo(words, () => remove.mutate(vars))
    }
    return id
  }
  return { resolve, busy: create.isPending }
}
