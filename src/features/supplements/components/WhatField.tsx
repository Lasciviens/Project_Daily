import { useMemo, useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { Link2Off } from 'lucide-react'
import { Truncate } from '../../../shared/ui'
import { chipClass } from '../../../shared/components/plan-modal/fieldStyles'
import { rankMatches } from '../../recipes/foodSearch'
import type { IngredientLibraryItem, Recipe } from '../../recipes/types'
import type { ScheduleSource } from '../scheduleForm'

type Option = { key: string; source: ScheduleSource; name: string; meta: string }

const foodMeta = (f: IngredientLibraryItem) =>
  `${f.calories != null ? Math.round(f.calories) : '–'} kcal / 100 ${f.unit === 'ml' ? 'ml' : 'g'}${f.serving_label ? ` · ${f.serving_label}` : ''}`
/** The name a link starts with: a product name up to its first comma
 *  ("Kreatin monohydrat, Bodylab" → "Kreatin monohydrat") — the owner can
 *  shorten it further; the phone's log_supplement also knows the full name. */
const shortName = (name: string) => name.split(',')[0].trim() || name.trim()
const recipeMeta = (r: Recipe) => `Recipe · ${r.calories != null ? Math.round(r.calories) : '–'} kcal a portion`

/**
 * What is taken: the name is the content (it is also the diary line's name
 * for a line of your own); typing searches your foods and recipes —
 * supplements first — and picking one links it, so a dose logs that food or
 * recipe with its own values. Typing keeps the link (a name of your own);
 * Unlink makes it your own line.
 */
export function WhatField({ title, source, foods, recipes, onChange }: {
  title: string
  source: ScheduleSource
  foods: readonly IngredientLibraryItem[]
  recipes: readonly Recipe[]
  onChange: (p: { title?: string; source?: ScheduleSource; food?: IngredientLibraryItem; recipe?: Recipe }) => void
}) {
  const [query, setQuery] = useState('')
  const options = useMemo<Option[]>(() => {
    const q = query.trim()
    const f = q ? rankMatches([...foods], q, x => x.name, 8)
      : foods.filter(x => x.food_group === 'Supplements').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)
    const r = q ? rankMatches([...recipes], q, x => x.title, 5)
      : recipes.filter(x => x.category === 'supplement').sort((a, b) => a.title.localeCompare(b.title)).slice(0, 5)
    return [
      ...f.map(x => ({ key: `food:${x.id}`, source: { kind: 'food', id: x.id } as ScheduleSource, name: x.name, meta: foodMeta(x) })),
      ...r.map(x => ({ key: `recipe:${x.id}`, source: { kind: 'recipe', id: x.id } as ScheduleSource, name: x.title, meta: recipeMeta(x) })),
    ]
  }, [foods, recipes, query])

  const linkedFood = source.kind === 'food' ? foods.find(f => f.id === source.id) : undefined
  const linkedRecipe = source.kind === 'recipe' ? recipes.find(r => r.id === source.id) : undefined

  function pick(key: string | null) {
    if (!key) return
    if (key.startsWith('food:')) {
      const food = foods.find(f => `food:${f.id}` === key)
      if (food) onChange({ title: shortName(food.name), source: { kind: 'food', id: food.id }, food })
    } else {
      const recipe = recipes.find(r => `recipe:${r.id}` === key)
      if (recipe) onChange({ title: shortName(recipe.title), source: { kind: 'recipe', id: recipe.id }, recipe })
    }
  }

  return (
    <div className="min-w-0">
      <Combobox value={null as string | null} onChange={pick} onClose={() => setQuery('')} immediate>
        <ComboboxInput
          aria-label="What you take" placeholder="What you take — Kreatin, Omega-3…" autoComplete="off"
          displayValue={() => title}
          onChange={e => { setQuery(e.target.value); onChange({ title: e.target.value }) }}
          className="input-bare w-full text-title font-semibold placeholder:font-normal"
        />
        <ComboboxOptions anchor="bottom start" className="menu z-toast max-h-72 w-[var(--input-width)] min-w-[16rem] overflow-y-auto [--anchor-gap:4px] empty:invisible">
          {options.map(o => (
            <ComboboxOption key={o.key} value={o.key} className="menu-item min-h-[40px] flex-col !items-start !gap-0 py-1">
              <Truncate className="w-full text-body text-fg">{o.name}</Truncate>
              <span className="text-micro tabular-nums text-fg-muted">{o.meta}</span>
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-meta text-fg-muted">
        {linkedFood || linkedRecipe ? (
          <>
            <Truncate className="min-w-0">{linkedFood ? `Your food ${linkedFood.name} · ${foodMeta(linkedFood)}` : `${linkedRecipe!.title} · ${recipeMeta(linkedRecipe!)}`}</Truncate>
            <button type="button" onClick={() => onChange({ source: { kind: 'custom' } })} className={chipClass('remove', 'h-6')}>
              <Link2Off aria-hidden />Unlink
            </button>
          </>
        ) : (
          <span>{source.kind === 'custom' ? 'Your own line — pick a food or a recipe to log its values' : 'The linked food is gone — this is your own line now'}</span>
        )}
      </div>
    </div>
  )
}
