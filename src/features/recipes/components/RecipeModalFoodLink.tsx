import { useMemo, useState } from 'react'
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { ChevronDown, Link2Off, Plus } from 'lucide-react'
import { Truncate } from '../../../shared/ui'
import { rankMatches } from '../foodSearch'
import { amountUnit } from '../foodBasket'
import type { IngredientLibraryItem } from '../types'

const NEW_FOOD = '__new__'
const UNLINK = '__unlink__'

/**
 * Links a recipe ingredient row to a library food (its macros feed the
 * recipe): a search box instead of a list of every food. Empty, it searches
 * the row's own name, so "Broccoli" already offers your broccoli.
 */
export function RecipeModalFoodLink({ value, rowName, library, onChange, onNew }: {
  value: string | null
  rowName: string
  library: readonly IngredientLibraryItem[]
  /** A food id, or null to unlink. */
  onChange: (id: string | null) => void
  /** "New library ingredient…": the inline new-food form. */
  onNew: () => void
}) {
  const [query, setQuery] = useState('')
  const linked = value ? library.find(l => l.id === value) ?? null : null
  const search = query.trim() || rowName.trim()
  const options = useMemo(
    () => (search ? rankMatches([...library], search, l => l.name, 30) : [...library].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30)),
    [library, search],
  )
  return (
    <Combobox value={value ?? ''} onChange={(v: string | null) => {
      if (v === NEW_FOOD) onNew()
      else if (v != null) onChange(v === UNLINK ? null : v)
    }} onClose={() => setQuery('')}>
      <div className="relative">
        <ComboboxInput aria-label="Library food for macros" placeholder="Link a food for macros — search…"
          displayValue={() => (linked ? `${linked.name} · ${linked.calories != null ? Math.round(linked.calories) : '–'} kcal / 100${amountUnit(linked.unit)}` : '')}
          onChange={e => setQuery(e.target.value)}
          className="input min-h-0 h-9 pr-8 text-meta" />
        <ComboboxButton aria-label="Show foods" className="absolute inset-y-0 right-0 grid w-8 place-items-center text-fg-faint">
          <ChevronDown aria-hidden className="h-4 w-4" />
        </ComboboxButton>
      </div>
      <ComboboxOptions anchor="bottom start" className="menu z-popover max-h-64 w-[var(--input-width)] overflow-y-auto [--anchor-gap:4px] empty:invisible">
        {options.map(l => (
          <ComboboxOption key={l.id} value={l.id} className="menu-item min-h-[40px] data-[selected]:font-semibold">
            <Truncate className="min-w-0 flex-1">{l.name}</Truncate>
            <span className="shrink-0 text-micro tabular-nums text-fg-muted">
              {l.calories != null ? `${Math.round(l.calories)} kcal` : '–'}{l.protein_g != null && ` · ${Math.round(l.protein_g)} g protein`}
            </span>
          </ComboboxOption>
        ))}
        {options.length === 0 && <p className="menu-label normal-case tracking-normal">No food matches</p>}
        <ComboboxOption value={NEW_FOOD} className="menu-item text-accent-700">
          <Plus aria-hidden className="h-4 w-4" /> New library ingredient…
        </ComboboxOption>
        {linked && (
          <ComboboxOption value={UNLINK} className="menu-item">
            <Link2Off aria-hidden className="h-4 w-4" /> Unlink
          </ComboboxOption>
        )}
      </ComboboxOptions>
    </Combobox>
  )
}
