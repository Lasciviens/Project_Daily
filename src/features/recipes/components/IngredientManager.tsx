import { useMemo, useRef, useState } from 'react'
import { useIngredientLibrary, useCreateIngredientLibraryItem, useUpdateIngredientLibraryItem, useDeleteIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { toast } from '../../../app/store'
import { FOOD_GROUPS, type IngredientLibraryItem } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  Standalone food-library manager. The front door for adding basic foods +
//  per-100g nutrition ONCE, then building meals from them everywhere. Now with:
//   • a full ADD *and* EDIT form matching the DB (name, unit, all 6 macros incl
//     sugar, primary portion, category) — editing was previously impossible
//     (updateIngredientLibraryItem was dead code; you had to delete + recreate).
//   • category filter pills (Matvaretabellen food groups + Supplements).
//   • the food's serving preset (serving_label + grams) shown as a chip.
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

const EMPTY = { name: '', unit: 'g', kcal: '', prot: '', carb: '', fat: '', fiber: '', sugar: '', servLabel: '', servGrams: '', group: '' }

export function IngredientManager() {
  const { data: library = [], isLoading } = useIngredientLibrary()
  const create = useCreateIngredientLibraryItem()
  const update = useUpdateIngredientLibraryItem()
  const remove = useDeleteIngredientLibraryItem()

  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [f, setF] = useState({ ...EMPTY })
  const formRef = useRef<HTMLDivElement>(null)

  const set = (k: keyof typeof EMPTY, v: string) => setF(prev => ({ ...prev, [k]: v }))

  // Which of the 16 groups actually appear (+ an "Other" bucket for null).
  const presentGroups = useMemo(() => {
    const s = new Set<string>()
    let hasOther = false
    for (const i of library) { if (i.food_group) s.add(i.food_group); else hasOther = true }
    const ordered = FOOD_GROUPS.filter(g => s.has(g))
    return { ordered, hasOther }
  }, [library])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => library.filter(i => {
    if (q && !i.name.toLowerCase().includes(q)) return false
    if (catFilter === '__other') return !i.food_group
    if (catFilter) return i.food_group === catFilter
    return true
  }), [library, q, catFilter])

  function reset() { setF({ ...EMPTY }); setEditingId(null) }

  function startEdit(ing: IngredientLibraryItem) {
    setEditingId(ing.id)
    const s = (n: number | null) => (n == null ? '' : String(n))
    setF({
      name: ing.name, unit: ing.unit || 'g',
      kcal: s(ing.calories), prot: s(ing.protein_g), carb: s(ing.carbs_g),
      fat: s(ing.fat_g), fiber: s(ing.fiber_g), sugar: s(ing.sugar_g),
      servLabel: ing.serving_label ?? '', servGrams: s(ing.serving_grams),
      group: ing.food_group ?? '',
    })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleSave() {
    if (!f.name.trim()) return
    const num = (s: string) => (s === '' ? null : Number(s))
    const input = {
      name: f.name, unit: f.unit.trim() || 'g',
      calories: num(f.kcal), protein_g: num(f.prot), carbs_g: num(f.carb),
      fat_g: num(f.fat), fiber_g: num(f.fiber), sugar_g: num(f.sugar),
      serving_label: f.servLabel || null, serving_grams: num(f.servGrams),
      food_group: f.group || null,
    }
    const tid = toast.loading(editingId ? 'Saving…' : 'Adding…')
    try {
      if (editingId) await update.mutateAsync({ id: editingId, input })
      else await create.mutateAsync(input)
      toast.dismiss(tid); toast.success(editingId ? 'Saved ✓' : 'Added ✓')
      reset()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    }
  }

  const inputCls = 'min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'
  const pill = (active: boolean) => `text-[11px] px-2.5 min-h-[32px] rounded-full border transition-colors ${active ? 'bg-accent-500 border-accent-500 text-white font-semibold' : 'border-ink-200 text-ink-600 hover:border-accent-300'}`
  const busy = create.isPending || update.isPending

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Add / edit form */}
      <div ref={formRef} className={`rounded-2xl border p-4 flex flex-col gap-2 ${editingId ? 'border-accent-300 bg-accent-50/40' : 'border-ink-200 bg-cream-50'}`}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{editingId ? '✎ Edit ingredient · per 100g' : '➕ New ingredient · macros per 100g'}</p>
          {editingId && <button type="button" onClick={reset} className="text-[11px] text-ink-400 hover:text-ink-700 min-h-[28px] px-1">Cancel</button>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          <input value={f.name} onChange={e => set('name', e.target.value)} placeholder="Name (Tavuk göğsü)" className={`${inputCls} col-span-2 sm:col-span-1`} />
          <input value={f.kcal} onChange={e => set('kcal', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Calories" className={inputCls} />
          <input value={f.prot} onChange={e => set('prot', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Protein g" className={inputCls} />
          <input value={f.carb} onChange={e => set('carb', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Carbs g" className={inputCls} />
          <input value={f.fat} onChange={e => set('fat', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fat g" className={inputCls} />
          <input value={f.fiber} onChange={e => set('fiber', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fiber g" className={inputCls} />
          <input value={f.sugar} onChange={e => set('sugar', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Sugar g" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <input value={f.servLabel} onChange={e => set('servLabel', e.target.value)} placeholder="Portion (1 scoop)" className={inputCls} />
          <input value={f.servGrams} onChange={e => set('servGrams', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams (30)" className={inputCls} />
          <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="Unit (g)" className={inputCls} />
          <select value={f.group} onChange={e => set('group', e.target.value)} className={inputCls}>
            <option value="">Category…</option>
            {FOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <button type="button" onClick={handleSave} disabled={busy || !f.name.trim()}
          className="self-start min-h-[40px] px-4 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors">
          {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add ingredient'}
        </button>
      </div>

      {/* Category filter pills */}
      {(presentGroups.ordered.length > 0 || presentGroups.hasOther) && (
        <div className="flex flex-wrap gap-1.5">
          <button className={pill(catFilter === null)} onClick={() => setCatFilter(null)}>All</button>
          {presentGroups.ordered.map(g => (
            <button key={g} className={pill(catFilter === g)} onClick={() => setCatFilter(g)}>{g}</button>
          ))}
          {presentGroups.hasOther && <button className={pill(catFilter === '__other')} onClick={() => setCatFilter('__other')}>Other</button>}
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl border border-ink-200 bg-cream-50 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-ink-100 flex items-center gap-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex-1">🧺 Your foods · {filtered.length}{catFilter || q ? ` / ${library.length}` : ''}</p>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
            className="min-h-[36px] px-2.5 text-xs border border-ink-200 rounded-lg bg-cream-50 w-40" />
        </div>
        {isLoading ? (
          <p className="text-xs text-ink-400 p-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-ink-400 p-4">{q || catFilter ? 'No match.' : 'Nothing yet — add your basics above (chicken, rice, oats, whey…).'}</p>
        ) : (
          <ul className="divide-y divide-ink-50">
            {filtered.slice(0, 300).map(ing => (
              <li key={ing.id} className="flex items-center gap-2 px-4 py-1.5 min-h-[44px] text-xs">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-ink-800 truncate block">{ing.name}</span>
                  {(ing.food_group || ing.serving_label) && (
                    <span className="flex flex-wrap items-center gap-1 mt-0.5">
                      {ing.food_group && <span className="text-[9px] text-ink-400 bg-ink-100/60 rounded px-1">{ing.food_group}</span>}
                      {ing.serving_label && ing.serving_grams != null && (
                        <span className="text-[9px] text-ink-400 border border-ink-100 rounded-full px-1">{ing.serving_label} {Math.round(ing.serving_grams)}g</span>
                      )}
                    </span>
                  )}
                </div>
                <span className="text-ink-500 tabular-nums shrink-0 w-14 text-right">{ing.calories ?? '—'}kcal</span>
                <span className="text-ink-500 tabular-nums shrink-0 w-10 text-right">{ing.protein_g ?? '—'}P</span>
                <span className="text-ink-400 tabular-nums shrink-0 w-10 text-right hidden sm:block">{ing.carbs_g ?? '—'}C</span>
                <span className="text-ink-400 tabular-nums shrink-0 w-10 text-right hidden sm:block">{ing.fat_g ?? '—'}F</span>
                <button onClick={() => startEdit(ing)} aria-label={`Edit ${ing.name}`}
                  className="min-w-[28px] min-h-[28px] text-ink-300 hover:text-accent-600 shrink-0">✎</button>
                <button onClick={() => { if (confirm(`Delete "${ing.name}"?`)) remove.mutate(ing.id) }} aria-label={`Delete ${ing.name}`}
                  className="min-w-[28px] min-h-[28px] text-ink-300 hover:text-red-500 shrink-0">×</button>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > 300 && <p className="text-[10px] text-ink-400 px-4 py-2">Showing first 300 — search or filter to narrow.</p>}
      </div>
      <p className="text-[11px] text-ink-400">Per-100g is the source of truth; portion presets are one-tap conveniences. Logged meals snapshot their macros — editing a food later never rewrites your history. Nutrition data: Matvaretabellen (Mattilsynet), NLOD.</p>
    </div>
  )
}
