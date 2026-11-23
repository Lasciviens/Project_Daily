import { useCreateShopCategory } from '../../hooks/useShop'
import { useResolveCategory } from '../../hooks/useCategorySuggestions'
import { isNewCategory, NEW_CATEGORY, newPickOf } from './useRecordDraft'
import type { ShopCategory } from '../../types'

/** The names typed for "+ New category…" / "+ New subcategory…" (never columns). */
export interface NewCategoryNames { new_top?: string; new_sub?: string }

/**
 * The category id a record's or a new thing's Save writes: a picked row as it is, a suggestion made now
 * (`useResolveCategory`, its Undo toast), a "+ New category…" made now from the names typed — the one way, in the record's
 * edit mode and in the create popup alike. Throws when a write fails (its hook said why), so the save stops there.
 */
export function useSaveCategory() {
  const createCategory = useCreateShopCategory()
  const suggested = useResolveCategory()

  async function makeNew(id: string, names: NewCategoryNames): Promise<string | null> {
    const p = newPickOf(id)
    let topId = p.topId
    if (topId === NEW_CATEGORY) topId = (await createCategory.mutateAsync({ name: (names.new_top ?? '').trim() })).id
    const sub = names.new_sub?.trim()
    if (sub && (p.subId === NEW_CATEGORY || p.topId === NEW_CATEGORY)) return (await createCategory.mutateAsync({ name: sub, parent_id: topId })).id
    return topId || null
  }

  async function resolve(categoryId: string | null | undefined, names: NewCategoryNames, categories: readonly ShopCategory[]): Promise<string | null> {
    if (isNewCategory(categoryId)) return makeNew(categoryId, names)
    return suggested.resolve(categoryId ?? null, categories)
  }

  return { resolve, busy: suggested.busy || createCategory.isPending }
}
