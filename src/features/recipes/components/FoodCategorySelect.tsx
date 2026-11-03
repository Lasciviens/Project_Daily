import { useState } from 'react'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { CATEGORY_MAX, cleanCategory, foodCategoryOptions } from '../foodLibraryModel'
import { cx } from '../../../shared/ui'

const NEW = '__new__'

/**
 * A food's category (owner: "Category — Let me add new category here"): None,
 * the built-in groups, the owner's own already given to a food
 * (foodLibraryModel.foodCategoryOptions), then "New category…", which turns
 * the field into a box. The box hands the category over when it is left or
 * Enter is pressed (cleanCategory: tidied, and an existing one typed in
 * another case is that one); Escape or an empty box brings the list back as
 * it was. The value is the category ('' = none), stored on the food when it
 * is saved — so a category nobody saves a food with is not kept.
 */
export function FoodCategorySelect({ value, onChange, className }: {
  value: string
  onChange: (category: string) => void
  className?: string
}) {
  const { data: library = [] } = useIngredientLibrary()
  // The category being typed after "New category…" (null = the list shows).
  const [draft, setDraft] = useState<string | null>(null)
  const options = foodCategoryOptions(library.map(l => l.food_group), value)

  if (draft !== null) {
    const commit = () => {
      const c = cleanCategory(draft, options)
      if (c) onChange(c)
      setDraft(null)
    }
    return (
      <input
        autoFocus value={draft} maxLength={CATEGORY_MAX} aria-label="New category" placeholder="New category, e.g. Snacks"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
        }}
        className={cx('input', className)}
      />
    )
  }
  return (
    <select
      value={value} aria-label="Category" className={cx('select', className)}
      onChange={e => {
        if (e.target.value === NEW) { setDraft(''); return }
        onChange(e.target.value)
      }}
    >
      <option value="">None</option>
      {options.map(c => <option key={c} value={c}>{c}</option>)}
      <option value={NEW}>New category…</option>
    </select>
  )
}
