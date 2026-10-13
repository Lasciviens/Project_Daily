import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ArrowDownUp, Check, Search } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { RECIPE_FLAGS, RECIPE_SORTS, type RecipeFlag, type RecipeSort } from '../foodLibraryModel'
import type { FoodCategory } from '../types'

const CATEGORIES: FoodCategory[] = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const GOAL_FLAGS: RecipeFlag[] = ['fits', 'high-protein', 'light']
const CHIP = 'pill-tab h-9 shrink-0 px-3'
const Divider = () => <span aria-hidden className="my-2 w-px shrink-0 bg-line" />

/**
 * The Library's controls in two rows on every width: one search (recipes and
 * foods) with the sort beside it, then one sideways-scrolling row of chips —
 * the goal filters first (Fits today, High protein, Under 500 kcal), then the
 * meal types, then No macros and Saved meals.
 */
export function LibraryTabFilters({ query, onQuery, sort, onSort, flags, onToggleFlag, category, onCategory, kcalLeft, savedCount }: {
  query: string
  onQuery: (q: string) => void
  sort: RecipeSort
  onSort: (s: RecipeSort) => void
  flags: RecipeFlag[]
  onToggleFlag: (f: RecipeFlag) => void
  category: FoodCategory | 'all'
  onCategory: (c: FoodCategory | 'all') => void
  /** Calories left today (null while loading) — shown on the Fits today chip. */
  kcalLeft: number | null
  savedCount: number
}) {
  const flag = (f: RecipeFlag) => {
    const def = RECIPE_FLAGS.find(x => x.value === f)!
    const label = f === 'fits' && kcalLeft != null ? (kcalLeft > 0 ? `Fits today's ${kcalLeft} kcal` : 'Fits today (0 kcal left)')
      : f === 'saved' ? `${def.label} (${savedCount})` : def.label
    return (
      <button key={f} type="button" aria-pressed={flags.includes(f)} onClick={() => onToggleFlag(f)} title={def.hint} className={cx(CHIP, 'tabular-nums')}>
        {label}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="relative block min-w-0 max-w-md flex-1">
          <span className="sr-only">Search recipes and foods</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Search recipes and foods"
            className="input pl-9" />
        </label>
        <SortPicker value={sort} onChange={onSort} />
      </div>
      <div className="scroll-x -mx-1 flex gap-1.5 px-1" role="group" aria-label="Show only">
        {GOAL_FLAGS.map(flag)}
        <Divider />
        {CATEGORIES.map(c => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => onCategory(category === c ? 'all' : c)}
            className={cx(CHIP, 'capitalize')}>
            {c}
          </button>
        ))}
        <Divider />
        {flag('no-macros')}
        {savedCount > 0 && flag('saved')}
      </div>
    </div>
  )
}

// The sort as one compact button: icon-only on a phone (the search keeps the
// row), icon + the current order from `sm`.
function SortPicker({ value, onChange }: { value: RecipeSort; onChange: (s: RecipeSort) => void }) {
  const current = RECIPE_SORTS.find(s => s.value === value) ?? RECIPE_SORTS[0]
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxButton aria-label={`Sort: ${current.label}`} title={`Sort: ${current.label}`}
        className="btn-secondary shrink-0 gap-1.5 px-3">
        <ArrowDownUp aria-hidden className="h-4 w-4" />
        <span className="max-sm:hidden">{current.label}</span>
      </ListboxButton>
      <ListboxOptions anchor="bottom end" className="menu w-48 [--anchor-gap:4px]">
        <p className="menu-label">Sort by</p>
        {RECIPE_SORTS.map(s => (
          <ListboxOption key={s.value} value={s.value} className="menu-item data-[selected]:font-semibold data-[selected]:text-fg">
            <span className="flex-1">{s.label}</span>
            {s.value === value && <Check aria-hidden className="h-4 w-4 text-accent-600" />}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}
