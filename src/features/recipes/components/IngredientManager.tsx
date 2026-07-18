import { useMemo, useState } from 'react'
import { useIngredientLibrary, useCreateIngredientLibraryItem, useDeleteIngredientLibraryItem } from '../hooks/useIngredientLibrary'

// ─────────────────────────────────────────────────────────────────────────────
//  Standalone ingredient-library manager — previously the ONLY way to create
//  a library ingredient was buried inside a recipe's "from ingredients" macro
//  mode (AssignMealModal literally told users to go make a recipe first).
//  This tab is the front door: add basic ingredients + their per-100g
//  nutrition ONCE, then build meals from them everywhere (FoodLogModal,
//  recipes, meal plan). Optional portion preset ("1 scoop" = 30 g) makes
//  logging countable foods one tap.
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

export function IngredientManager() {
  const { data: library = [], isLoading } = useIngredientLibrary()
  const create = useCreateIngredientLibraryItem()
  const remove = useDeleteIngredientLibraryItem()

  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState(''); const [prot, setProt] = useState('')
  const [carb, setCarb] = useState(''); const [fat, setFat] = useState('')
  const [fiber, setFiber] = useState('')
  const [servLabel, setServLabel] = useState(''); const [servGrams, setServGrams] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? library.filter(i => i.name.toLowerCase().includes(q)) : library),
    [library, q],
  )

  async function handleAdd() {
    if (!name.trim()) return
    const num = (s: string) => (s === '' ? null : Number(s))
    await create.mutateAsync({
      name, calories: num(kcal), protein_g: num(prot), carbs_g: num(carb),
      fat_g: num(fat), fiber_g: num(fiber),
      serving_label: servLabel || null, serving_grams: num(servGrams),
    })
    setName(''); setKcal(''); setProt(''); setCarb(''); setFat(''); setFiber(''); setServLabel(''); setServGrams('')
  }

  const inputCls = 'min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Add form — the one-time cost per new food */}
      <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">➕ New ingredient · macros per 100g</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (Tavuk göğsü)" className={`${inputCls} col-span-2 sm:col-span-1`} />
          <input value={kcal} onChange={e => setKcal(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Calories" className={inputCls} />
          <input value={prot} onChange={e => setProt(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Protein g" className={inputCls} />
          <input value={carb} onChange={e => setCarb(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Carbs g" className={inputCls} />
          <input value={fat} onChange={e => setFat(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fat g" className={inputCls} />
          <input value={fiber} onChange={e => setFiber(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fiber g" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-w-sm">
          <input value={servLabel} onChange={e => setServLabel(e.target.value)} placeholder="Portion (1 scoop)" className={inputCls} />
          <input value={servGrams} onChange={e => setServGrams(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams (30)" className={inputCls} />
        </div>
        <button type="button" onClick={handleAdd} disabled={create.isPending || !name.trim()}
          className="self-start min-h-[40px] px-4 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors">
          {create.isPending ? 'Adding…' : 'Add ingredient'}
        </button>
      </div>

      {/* List — dense one-line rows (width standard: ≤640px rows, capped) */}
      <div className="rounded-2xl border border-ink-200 bg-cream-50 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-ink-100 flex items-center gap-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex-1">🧺 Your ingredients · {library.length}</p>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
            className="min-h-[36px] px-2.5 text-xs border border-ink-200 rounded-lg bg-cream-50 w-40" />
        </div>
        {isLoading ? (
          <p className="text-xs text-ink-400 p-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-ink-400 p-4">{q ? 'No match.' : 'Nothing yet — add your basics above (chicken, rice, oats, whey…).'}</p>
        ) : (
          <ul className="divide-y divide-ink-50">
            {filtered.map(ing => (
              <li key={ing.id} className="flex items-center gap-2 px-4 py-1.5 min-h-[40px] text-xs">
                <span className="font-medium text-ink-800 flex-1 min-w-0 truncate">{ing.name}</span>
                {ing.serving_label && ing.serving_grams != null && (
                  <span className="text-[10px] text-ink-400 border border-ink-100 rounded-full px-1.5 shrink-0">{ing.serving_label} = {ing.serving_grams}g</span>
                )}
                <span className="text-ink-500 tabular-nums shrink-0 w-16 text-right">{ing.calories ?? '—'} kcal</span>
                <span className="text-ink-500 tabular-nums shrink-0 w-12 text-right">{ing.protein_g ?? '—'}P</span>
                <span className="text-ink-400 tabular-nums shrink-0 w-12 text-right hidden sm:block">{ing.carbs_g ?? '—'}C</span>
                <span className="text-ink-400 tabular-nums shrink-0 w-12 text-right hidden sm:block">{ing.fat_g ?? '—'}F</span>
                <button onClick={() => { if (confirm(`Delete "${ing.name}"?`)) remove.mutate(ing.id) }}
                  className="min-w-[28px] min-h-[28px] text-ink-300 hover:text-red-500 shrink-0">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-ink-400">Per-100g is the source of truth; the portion preset is a one-tap convenience. Logged meals snapshot their macros — editing an ingredient later never rewrites your history.</p>
    </div>
  )
}
