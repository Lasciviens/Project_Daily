import { useMemo, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useIngredientLibrary, useCreateIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries } from '../hooks/useFoodLog'
import { ingredientSnapshot } from '../api/foodLogApi'
import type { IngredientLibraryItem, FoodLogEntryInput, MealSlot } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  BUILD-A-MEAL logger — the core "lazy athlete" flow the expert panel
//  designed: pick ingredients from YOUR library, type grams (or tap the
//  portion preset like "1 scoop"), watch kcal/protein total live, save once.
//  Saves into food_log_entries (the diary — macros snapshotted at log time).
//  A brand-new food is added to the library inline ONCE (name + per-100g
//  macros) and is a 3-tap food forever after.
// ─────────────────────────────────────────────────────────────────────────────

const SLOTS: { id: MealSlot; label: string }[] = [
  { id: 'breakfast',  label: '🌅 Breakfast' },
  { id: 'lunch',      label: '☀️ Lunch' },
  { id: 'dinner',     label: '🌙 Dinner' },
  { id: 'snack',      label: '🍎 Snack' },
  { id: 'supplement', label: '💊 Supplement' },
]

// Sensible default slot from the time of day.
function slotForNow(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

interface BasketItem {
  ingredient: IngredientLibraryItem
  grams:      number
}

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

interface Props {
  open:        boolean
  onClose:     () => void
  date:        string
  defaultSlot?: MealSlot
}

export function FoodLogModal({ open, onClose, date, defaultSlot }: Props) {
  const { data: library = [] } = useIngredientLibrary()
  const createIngredient = useCreateIngredientLibraryItem()
  const addEntries = useAddFoodLogEntries()

  const [slot, setSlot] = useState<MealSlot>(defaultSlot ?? slotForNow())
  const [query, setQuery] = useState('')
  const [basket, setBasket] = useState<BasketItem[]>([])
  const [showNew, setShowNew] = useState(false)
  // Inline new-ingredient form (one-time cost per new food)
  const [nName, setNName] = useState('')
  const [nKcal, setNKcal] = useState(''); const [nProt, setNProt] = useState('')
  const [nCarb, setNCarb] = useState(''); const [nFat, setNFat] = useState('')
  const [nFiber, setNFiber] = useState('')
  const [nServLabel, setNServLabel] = useState(''); const [nServGrams, setNServGrams] = useState('')

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? library.filter(i => i.name.toLowerCase().includes(q)) : library).slice(0, 12),
    [library, q],
  )

  function addToBasket(ing: IngredientLibraryItem, grams?: number) {
    setBasket(b => [...b, { ingredient: ing, grams: grams ?? ing.serving_grams ?? 100 }])
    setQuery('')
  }

  function setGrams(idx: number, raw: string) {
    const n = Number(sanitizeDecimal(raw))
    setBasket(b => b.map((it, i) => (i === idx ? { ...it, grams: Number.isFinite(n) ? n : 0 } : it)))
  }

  const totals = basket.reduce(
    (acc, it) => {
      const s = ingredientSnapshot(it.ingredient, it.grams)
      return { kcal: acc.kcal + (s.calories ?? 0), prot: acc.prot + (s.protein_g ?? 0) }
    },
    { kcal: 0, prot: 0 },
  )

  async function handleNewIngredient() {
    if (!nName.trim()) return
    const num = (s: string) => (s === '' ? null : Number(s))
    const created = await createIngredient.mutateAsync({
      name: nName, calories: num(nKcal), protein_g: num(nProt), carbs_g: num(nCarb),
      fat_g: num(nFat), fiber_g: num(nFiber),
      serving_label: nServLabel || null, serving_grams: num(nServGrams),
    })
    addToBasket(created)
    setShowNew(false)
    setNName(''); setNKcal(''); setNProt(''); setNCarb(''); setNFat(''); setNFiber(''); setNServLabel(''); setNServGrams('')
  }

  async function handleSave() {
    if (basket.length === 0) return
    const entries: FoodLogEntryInput[] = basket.map(it => ({
      date,
      meal_slot: slot,
      library_ingredient_id: it.ingredient.id,
      quantity: it.grams,
      unit: 'g',
      ...ingredientSnapshot(it.ingredient, it.grams),
    }))
    await addEntries.mutateAsync(entries)
    setBasket([])
    onClose()
  }

  const inputCls = 'min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[92vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="px-5 pt-5 pb-3 border-b border-ink-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink-900">🍽️ Log food</h2>
            <button type="button" onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Slot */}
            <div className="flex flex-wrap gap-1.5">
              {SLOTS.map(s => (
                <button key={s.id} type="button" onClick={() => setSlot(s.id)}
                  className={`text-xs px-2.5 min-h-[36px] rounded-full border transition-colors ${
                    slot === s.id ? 'bg-accent-500 border-accent-500 text-white font-semibold' : 'border-ink-200 text-ink-600 hover:border-accent-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Search + pick */}
            <div>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search your ingredients… (e.g. tavuk, pirinç)"
                className={`w-full ${inputCls}`}
              />
              {(q || library.length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {matches.map(ing => (
                    <button key={ing.id} type="button" onClick={() => addToBasket(ing)}
                      className="text-xs px-2.5 min-h-[36px] rounded-full border border-ink-200 bg-cream-100 text-ink-700 hover:border-accent-400 transition-colors press-feedback"
                      title={ing.calories != null ? `${ing.calories} kcal /100g` : undefined}>
                      + {ing.name}
                      {ing.serving_label && <span className="text-ink-400 ml-1">({ing.serving_label})</span>}
                    </button>
                  ))}
                  {q && matches.length === 0 && (
                    <p className="text-xs text-ink-400 py-1">Not in your library yet.</p>
                  )}
                  <button type="button" onClick={() => { setShowNew(v => !v); setNName(query.trim()) }}
                    className="text-xs px-2.5 min-h-[36px] rounded-full border border-dashed border-accent-300 text-accent-600 hover:bg-accent-50 transition-colors">
                    ✨ New ingredient…
                  </button>
                </div>
              )}
            </div>

            {/* Inline new-ingredient form (per-100g) */}
            {showNew && (
              <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-3 flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-accent-700">New library ingredient — macros per 100g (one-time; reusable forever)</p>
                <input value={nName} onChange={e => setNName(e.target.value)} placeholder="Name (e.g. Tavuk göğsü)" className={inputCls} />
                <div className="grid grid-cols-3 gap-1.5">
                  <input value={nKcal}  onChange={e => setNKcal(sanitizeDecimal(e.target.value))}  inputMode="decimal" placeholder="Calories" className={inputCls} />
                  <input value={nProt}  onChange={e => setNProt(sanitizeDecimal(e.target.value))}  inputMode="decimal" placeholder="Protein g" className={inputCls} />
                  <input value={nCarb}  onChange={e => setNCarb(sanitizeDecimal(e.target.value))}  inputMode="decimal" placeholder="Carbs g" className={inputCls} />
                  <input value={nFat}   onChange={e => setNFat(sanitizeDecimal(e.target.value))}   inputMode="decimal" placeholder="Fat g" className={inputCls} />
                  <input value={nFiber} onChange={e => setNFiber(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fiber g" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={nServLabel} onChange={e => setNServLabel(e.target.value)} placeholder="Portion label (1 scoop)" className={inputCls} />
                  <input value={nServGrams} onChange={e => setNServGrams(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams (30)" className={inputCls} />
                </div>
                <button type="button" onClick={handleNewIngredient} disabled={createIngredient.isPending || !nName.trim()}
                  className="self-start min-h-[36px] px-3 rounded-lg text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
                  {createIngredient.isPending ? 'Adding…' : 'Add & put in meal'}
                </button>
              </div>
            )}

            {/* Basket */}
            {basket.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">This meal</p>
                {basket.map((it, i) => {
                  const s = ingredientSnapshot(it.ingredient, it.grams)
                  return (
                    <div key={`${it.ingredient.id}-${i}`} className="flex items-center gap-2">
                      <span className="text-sm text-ink-800 flex-1 min-w-0 truncate">{it.ingredient.name}</span>
                      {it.ingredient.serving_label && it.ingredient.serving_grams != null && (
                        <button type="button" onClick={() => setGrams(i, String(it.ingredient.serving_grams))}
                          className="text-[10px] px-1.5 min-h-[28px] rounded border border-ink-200 text-ink-500 hover:border-accent-300 shrink-0">
                          {it.ingredient.serving_label}
                        </button>
                      )}
                      <input
                        value={it.grams || ''}
                        onChange={e => setGrams(i, e.target.value)}
                        inputMode="decimal"
                        className="w-16 min-h-[36px] px-2 text-sm text-right border border-ink-200 rounded-lg bg-cream-50 tabular-nums"
                      />
                      <span className="text-[11px] text-ink-400 w-4">g</span>
                      <span className="text-[11px] text-ink-500 tabular-nums w-16 text-right shrink-0">{Math.round(s.calories ?? 0)} kcal</span>
                      <button type="button" onClick={() => setBasket(b => b.filter((_, j) => j !== i))}
                        className="min-w-[32px] min-h-[32px] text-ink-300 hover:text-red-500">×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer — live totals + save */}
          <div className="px-5 py-3.5 border-t border-ink-100 flex items-center gap-3 sticky bottom-0 bg-cream-50">
            <p className="text-sm text-ink-700 flex-1 tabular-nums">
              <strong className="text-ink-900">{Math.round(totals.kcal)}</strong> kcal
              <span className="text-ink-300"> · </span>
              <strong className="text-ink-900">{Math.round(totals.prot)}</strong> g protein
            </p>
            <button type="button" onClick={handleSave} disabled={basket.length === 0 || addEntries.isPending}
              className="min-h-[44px] px-5 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors">
              {addEntries.isPending ? 'Saving…' : `Log ${basket.length || ''} item${basket.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
