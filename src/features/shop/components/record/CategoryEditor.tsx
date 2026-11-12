import { categoryIdOf, pickOf } from '../../shopModel'
import { CategoryPicker } from '../CategoryPicker'
import { isNewCategory, NEW_CATEGORY, newCategoryId, newPickOf, type RecordDraft } from './useRecordDraft'
import type { ShopCategory, ShopItem } from '../../types'

/** The record's Category fact: the two selects with "+ New category…", named here and made on Save (the add sheet's way). */
export function CategoryEditor({ v, set, categories }: { v: ShopItem & RecordDraft; set: (patch: RecordDraft) => void; categories: readonly ShopCategory[] }) {
  const pick = isNewCategory(v.category_id) ? newPickOf(v.category_id) : pickOf(v.category_id, categories)
  const newTop = pick.topId === NEW_CATEGORY
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <CategoryPicker categories={categories} value={pick} newValue={NEW_CATEGORY}
          onChange={p => { const made = newCategoryId(p); set(made ? { category_id: made } : { category_id: categoryIdOf(p), new_top: undefined, new_sub: undefined }) }}
          sub={newTop ? <input value={v.new_top ?? ''} onChange={e => set({ new_top: e.target.value })} placeholder="New category" aria-label="New category name" className="input" /> : undefined} />
      </div>
      {(newTop || pick.subId === NEW_CATEGORY) && (
        <input value={v.new_sub ?? ''} onChange={e => set({ new_sub: e.target.value })}
          placeholder={newTop ? 'Subcategory (optional)' : 'New subcategory'} aria-label="New subcategory name" className="input" />
      )}
    </>
  )
}
