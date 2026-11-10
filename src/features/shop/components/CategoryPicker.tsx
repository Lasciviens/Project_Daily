import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { cx } from '../../../shared/ui'
import { useAddSuggestedCategory } from '../hooks/useCategorySuggestions'
import { suggestedSubs, suggestedTops } from '../shopTaxonomy'
import type { CategoryPick } from '../shopModel'
import type { ShopCategory } from '../types'

const SUGGEST = 'suggest:'
const byName = (a: ShopCategory, b: ShopCategory) => a.name.localeCompare(b.name, 'nb')

/**
 * The category and subcategory of a thing, as two selects (for the caller's
 * grid): the owner's own categories first, then "Suggested" ones they don't
 * have yet (shopTaxonomy). Picking a suggestion adds it there and then
 * ("Headphones added under Electronics · Undo") and picks it; Undo steps the
 * picker back. `newValue`: the item form's "+ New category…" choices, which
 * it names and makes on save; `sub` takes the subcategory's place (the form's
 * name field for a new category). Ids are '' for none.
 */
export function CategoryPicker({ categories, value, onChange, newValue, sub, className }: {
  categories: readonly ShopCategory[]
  value: CategoryPick
  onChange: (next: CategoryPick) => void
  newValue?: string
  sub?: ReactNode
  className?: string
}) {
  const { add, busy } = useAddSuggestedCategory()
  // Undo comes later, from the toast: it steps back from what is picked then, not from this render's props.
  const latest = useRef({ value, onChange })
  useLayoutEffect(() => { latest.current = { value, onChange } })
  const tops = categories.filter(c => !c.parent_id).sort(byName)
  const top = tops.find(t => t.id === value.topId) ?? null
  const subs = top ? categories.filter(c => c.parent_id === top.id).sort(byName) : []
  const moreTops = suggestedTops(categories)
  const moreSubs = top ? suggestedSubs(categories, top.id) : []

  async function pick(name: string, parent: ShopCategory | null) {
    const before = value
    const row = await add(name, parent, made => {
      const now = latest.current
      if (now.value.topId === made.id || now.value.subId === made.id) now.onChange(before)
    })
    if (row) latest.current.onChange(parent ? { topId: parent.id, subId: row.id } : { topId: row.id, subId: '' })
  }

  const select = cx('select disabled:opacity-50', className)
  return (
    <>
      <select value={value.topId} aria-label="Category" aria-busy={busy || undefined} disabled={busy} className={select}
        onChange={e => {
          const v = e.target.value
          if (v.startsWith(SUGGEST)) void pick(v.slice(SUGGEST.length), null)
          else onChange({ topId: v, subId: '' })
        }}>
        <option value="">No category</option>
        {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        {moreTops.length > 0 && (
          <optgroup label="Suggested">
            {moreTops.map(n => <option key={n} value={`${SUGGEST}${n}`}>{n}</option>)}
          </optgroup>
        )}
        {newValue && <option value={newValue}>+ New category…</option>}
      </select>
      {sub ?? <select value={value.subId} aria-label="Subcategory" aria-busy={busy || undefined} disabled={busy || !top} className={select}
        onChange={e => {
          const v = e.target.value
          if (v.startsWith(SUGGEST)) void pick(v.slice(SUGGEST.length), top)
          else onChange({ topId: value.topId, subId: v })
        }}>
        <option value="">{top ? 'No subcategory' : 'Subcategory'}</option>
        {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        {moreSubs.length > 0 && (
          <optgroup label="Suggested">
            {moreSubs.map(n => <option key={n} value={`${SUGGEST}${n}`}>{n}</option>)}
          </optgroup>
        )}
        {newValue && top && <option value={newValue}>+ New subcategory…</option>}
      </select>}
    </>
  )
}
