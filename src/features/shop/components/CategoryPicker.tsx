import { useEffect, useState, type ReactNode } from 'react'
import { Button, cx } from '../../../shared/ui'
import { useAddSuggestedCategories } from '../hooks/useAddSuggestedCategories'
import { SUGGESTED, isSuggested, type CategoryPick } from '../shopModel'
import { pickWithMade, suggestedSubs, suggestedTops } from '../shopTaxonomy'
import type { ShopCategory } from '../types'

const byName = (a: ShopCategory, b: ShopCategory) => a.name.localeCompare(b.name, 'nb')
/** The Suggested group's first line: never a value — it asks (below) before anything is made. */
const ADD_ALL = 'add-suggested'

/**
 * The category and subcategory of a thing, as two selects (for the caller's
 * grid): the owner's own categories first, then "Suggested" ones they don't
 * have yet (shopTaxonomy). A suggestion is only picked here ("suggest:Name");
 * the sheet's Save makes it (useResolveCategory), the way "+ New category…"
 * works — so cancelling leaves nothing, and scrolling an iOS picker past one
 * makes nothing. The Suggested group opens with "Add the suggested categories
 * (34)": choosing it only asks, in a line under the selects (an iOS picker
 * scroll changes the select), and that line's Add makes them all
 * (useAddSuggestedCategories) — the pick then names the rows made.
 * `newValue`: the item form's "+ New category…" choices, which
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
  const tops = categories.filter(c => !c.parent_id).sort(byName)
  const top = tops.find(t => t.id === value.topId) ?? null
  const suggestedTop = isSuggested(value.topId)
  const subs = top ? categories.filter(c => c.parent_id === top.id).sort(byName) : []
  const moreTops = suggestedTops(categories)
  const moreSubs = top || suggestedTop ? suggestedSubs(categories, value.topId) : []
  const all = useAddSuggestedCategories(categories)
  const allCount = all.count ?? 0
  const [asking, setAsking] = useState(false)

  // A suggestion picked here that has been made since (Add the suggested categories, from any picker) is that row now.
  useEffect(() => {
    const next = pickWithMade(value, categories)
    if (next !== value) onChange(next)
  }, [value, categories, onChange])

  async function addAll() {
    if (await all.add()) setAsking(false)
  }

  const select = cx('select disabled:opacity-50', className)
  return (
    <>
      <select value={value.topId} aria-label="Category" className={select}
        onChange={e => { if (e.target.value === ADD_ALL) setAsking(true); else onChange({ topId: e.target.value, subId: '' }) }}>
        <option value="">No category</option>
        {tops.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        {(allCount > 0 || moreTops.length > 0) && (
          <optgroup label="Suggested">
            {allCount > 0 && <option value={ADD_ALL}>Add the suggested categories ({allCount})</option>}
            {moreTops.map(n => <option key={n} value={`${SUGGESTED}${n}`}>{n}</option>)}
          </optgroup>
        )}
        {newValue && <option value={newValue}>+ New category…</option>}
      </select>
      {sub ?? <select value={value.subId} aria-label="Subcategory" disabled={!top && !suggestedTop} className={select}
        onChange={e => onChange({ topId: value.topId, subId: e.target.value })}>
        <option value="">{top || suggestedTop ? 'No subcategory' : 'Subcategory'}</option>
        {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        {moreSubs.length > 0 && (
          <optgroup label="Suggested">
            {moreSubs.map(n => <option key={n} value={`${SUGGESTED}${n}`}>{n}</option>)}
          </optgroup>
        )}
        {newValue && top && <option value={newValue}>+ New subcategory…</option>}
      </select>}
      {asking && allCount > 0 && (
        <div className="col-span-full flex items-center gap-2">
          <span className="mr-auto min-w-0 text-meta text-fg-2">Add all {allCount} suggested categories?</span>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Not now</Button>
          <Button size="sm" variant="primary" loading={all.busy} onClick={() => { void addAll() }}>Add</Button>
        </div>
      )}
    </>
  )
}
