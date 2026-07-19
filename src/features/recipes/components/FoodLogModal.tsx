import { useMemo, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useIngredientLibrary, useCreateIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries, useRecentFoods } from '../hooks/useFoodLog'
import { useQueryClient } from '@tanstack/react-query'
import { useRecipes, useCreateRecipe } from '../hooks/useRecipes'
import { ingredientSnapshot, recipeSnapshot, addFoodLogEntries, type RecentFood } from '../api/foodLogApi'
import { lookupBarcode } from '../api/openFoodFactsApi'
import { BarcodeScanner } from './BarcodeScanner'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { toast } from '../../../app/store'
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
  open:         boolean
  onClose:      () => void
  date:         string
  defaultSlot?: MealSlot
  /** Prefill the search box (e.g. free text typed on the Daily card). */
  defaultQuery?: string
}

export function FoodLogModal({ open, onClose, date, defaultSlot, defaultQuery }: Props) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recents = [] } = useRecentFoods()
  const { data: recipes = [] } = useRecipes()
  const createIngredient = useCreateIngredientLibraryItem()
  const createRecipe = useCreateRecipe()
  const addEntries = useAddFoodLogEntries()
  const qc = useQueryClient()
  const { data: nut } = useDayNutrition(date)
  const { targets } = useDayTargets()

  const [slot, setSlot] = useState<MealSlot>(defaultSlot ?? slotForNow())
  const [query, setQuery] = useState(defaultQuery ?? '')
  const [mealName, setMealName] = useState('')

  // Re-seed slot/query each time the modal transitions closed→open (the
  // instance is reused across opens). Adjusting state during render on a
  // prop change is React's recommended pattern over a setState-in-effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSlot(defaultSlot ?? slotForNow())
      setQuery(defaultQuery ?? '')
      setMealName('')
    }
  }

  const [basket, setBasket] = useState<BasketItem[]>([])
  const [showNew, setShowNew] = useState(false)
  // Inline new-ingredient form (one-time cost per new food)
  const [nName, setNName] = useState('')
  const [nKcal, setNKcal] = useState(''); const [nProt, setNProt] = useState('')
  const [nCarb, setNCarb] = useState(''); const [nFat, setNFat] = useState('')
  const [nFiber, setNFiber] = useState('')
  const [nServLabel, setNServLabel] = useState(''); const [nServGrams, setNServGrams] = useState('')

  const [scanOpen, setScanOpen] = useState(false)
  const [scanning, setScanning] = useState(false)

  // Barcode → Open Food Facts → prefill the new-ingredient form for review.
  // If the product already exists in the library by name, add it straight to
  // the basket instead. Nothing is auto-saved — the user confirms per-100g.
  async function handleBarcode(code: string) {
    setScanOpen(false); setScanning(true)
    const tid = toast.loading('Looking up barcode…')
    try {
      const p = await lookupBarcode(code)
      toast.dismiss(tid)
      if (!p) { toast.error('Product not found in Open Food Facts'); return }
      const existing = library.find(i => i.name.toLowerCase() === p.name.toLowerCase())
      if (existing) { addToBasket(existing); toast.success(`${p.name} — already in your library ✓`); return }
      // Prefill + reveal the new-ingredient form (per-100g, editable).
      setNName(p.name)
      setNKcal(p.calories != null ? String(p.calories) : '')
      setNProt(p.protein_g != null ? String(p.protein_g) : '')
      setNCarb(p.carbs_g != null ? String(p.carbs_g) : '')
      setNFat(p.fat_g != null ? String(p.fat_g) : '')
      setNFiber(p.fiber_g != null ? String(p.fiber_g) : '')
      setNServLabel(p.serving_grams != null ? '1 serving' : '')
      setNServGrams(p.serving_grams != null ? String(p.serving_grams) : '')
      setShowNew(true)
      toast.success(`Found: ${p.name} — review & add`)
    } catch {
      toast.dismiss(tid); toast.error('Barcode lookup failed')
    } finally { setScanning(false) }
  }

  // Recent/frequent food (from the diary) → add to the basket if it's a library
  // ingredient; a recipe/custom recent re-logs its own snapshot directly.
  function addRecent(r: RecentFood) {
    const lib = r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) : null
    if (lib) { addToBasket(lib); return }
    addEntries.mutate([{
      date, meal_slot: slot,
      library_ingredient_id: r.library_ingredient_id, recipe_id: r.recipe_id, custom_title: r.custom_title,
      quantity: r.quantity, unit: r.unit,
      calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g, sugar_g: r.sugar_g,
    }], { onSuccess: onClose })
  }

  // Log a saved recipe as ONE named diary line (recipe_id + snapshot) — the
  // "I ate <dish>" path. Servings default 1; adjust from the recipe detail.
  function logRecipe(rec: typeof recipes[number]) {
    addEntries.mutate([{ date, meal_slot: slot, recipe_id: rec.id, quantity: 1, unit: 'serving', ...recipeSnapshot(rec, 1) }], { onSuccess: onClose })
  }

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

  // Save the basket as a reusable NAMED meal (a recipe) AND log it as one line.
  // recipes carries no fiber column, so fiber is snapshotted onto the diary row
  // straight from the basket. This is the "build a meal from ingredients, name
  // it, eat it" flow — reusable forever after via 'Log a saved meal'.
  async function handleSaveAsMeal() {
    if (basket.length === 0 || !mealName.trim()) return
    const r1 = (n: number) => Math.round(n * 10) / 10
    const m = basket.reduce((a, it) => {
      const s = ingredientSnapshot(it.ingredient, it.grams)
      return { calories: a.calories + (s.calories ?? 0), protein_g: a.protein_g + (s.protein_g ?? 0), carbs_g: a.carbs_g + (s.carbs_g ?? 0), fat_g: a.fat_g + (s.fat_g ?? 0), fiber_g: a.fiber_g + (s.fiber_g ?? 0), sugar_g: a.sugar_g + (s.sugar_g ?? 0) }
    }, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 })
    const tid = toast.loading('Saving meal…')
    try {
      const recipeId = await createRecipe.mutateAsync({
        title: mealName.trim(), servings: 1, macro_mode: 'manual',
        calories: r1(m.calories), protein_g: r1(m.protein_g), carbs_g: r1(m.carbs_g), fat_g: r1(m.fat_g), sugar_g: r1(m.sugar_g),
        ingredients: basket.map(it => ({ name: it.ingredient.name, quantity: it.grams, unit: 'g', note: null, library_ingredient_id: it.ingredient.id })),
      })
      // Raw insert (not the toasting hook) so we show ONE clear toast, then
      // invalidate the nutrition views ourselves.
      await addFoodLogEntries([{ date, meal_slot: slot, recipe_id: recipeId, quantity: 1, unit: 'serving', calories: r1(m.calories), protein_g: r1(m.protein_g), carbs_g: r1(m.carbs_g), fat_g: r1(m.fat_g), fiber_g: r1(m.fiber_g), sugar_g: r1(m.sugar_g) }])
      qc.invalidateQueries({ queryKey: ['food-log'] }); qc.invalidateQueries({ queryKey: ['meal-plan'] })
      toast.dismiss(tid); toast.success(`Saved & logged "${mealName.trim()}" ✓`)
      setBasket([]); setMealName(''); onClose()
    } catch (e) { toast.dismiss(tid); toast.error((e as Error).message ?? 'Failed') }
  }

  const inputCls = 'min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
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

            {/* Recent / frequent first (from the diary) — the fast path: what
                you actually eat, before the 2000-row alphabetical library. */}
            {!q && recents.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">🕒 Recent</p>
                <div className="flex flex-wrap gap-1.5">
                  {recents.slice(0, 8).map(r => (
                    <button key={r.key} type="button" onClick={() => addRecent(r)}
                      className="text-xs px-2.5 min-h-[36px] rounded-full border border-ink-200 bg-cream-100 text-ink-700 hover:border-accent-400 transition-colors press-feedback">
                      + {r.title}{r.protein_g != null && r.protein_g > 0 && <span className="text-ink-400 ml-1">{Math.round(r.protein_g)}p</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Log a saved meal as ONE named line (recipe → diary). */}
            {recipes.length > 0 && recipes.some(r => !q || r.title.toLowerCase().includes(q)) && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">🍲 Log a saved meal</p>
                <div className="flex flex-wrap gap-1.5">
                  {recipes.filter(r => !q || r.title.toLowerCase().includes(q)).slice(0, 6).map(r => (
                    <button key={r.id} type="button" onClick={() => logRecipe(r)}
                      className="text-xs px-2.5 min-h-[36px] rounded-full border border-accent-200 bg-accent-50/50 text-accent-700 hover:border-accent-400 transition-colors">
                      🍲 {r.title}{r.calories != null && <span className="text-accent-500/70 ml-1">{Math.round(r.calories)}kcal</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search + pick */}
            <div>
              <div className="flex gap-1.5">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search your ingredients… (e.g. tavuk, pirinç)"
                  className={`flex-1 min-w-0 ${inputCls}`}
                />
                {/* Barcode scan → Open Food Facts */}
                <button type="button" onClick={() => setScanOpen(true)} disabled={scanning}
                  className="shrink-0 min-w-[44px] min-h-[40px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-ink-600 hover:border-accent-400 disabled:opacity-50 flex items-center justify-center text-lg"
                  title="Scan a barcode (Open Food Facts)" aria-label="Scan barcode">
                  📷
                </button>
              </div>
              {(q || library.length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {matches.map(ing => (
                    <button key={ing.id} type="button" onClick={() => addToBasket(ing)}
                      className="text-xs px-2.5 min-h-[36px] rounded-full border border-ink-200 bg-cream-100 text-ink-700 hover:border-accent-400 transition-colors press-feedback">
                      + {ing.name}
                      {/* per-100g basis visible (was hidden in a title tooltip = invisible on mobile) */}
                      {ing.calories != null && <span className="text-ink-400 ml-1">{Math.round(ing.calories)}kcal/100g</span>}
                      {ing.serving_label && <span className="text-ink-400 ml-1">· {ing.serving_label}</span>}
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
                  const sg = it.ingredient.serving_grams
                  const count = sg ? Math.max(1, Math.round(it.grams / sg)) : 1
                  return (
                    <div key={`${it.ingredient.id}-${i}`} className="flex items-center gap-2">
                      <span className="text-sm text-ink-800 flex-1 min-w-0 truncate">{it.ingredient.name}</span>
                      {/* Portion stepper — "2 eggs" in one tap (×N of the preset). */}
                      {it.ingredient.serving_label && sg != null && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button type="button" aria-label="one less" onClick={() => setGrams(i, String(Math.max(1, count - 1) * sg))}
                            className="min-w-[28px] min-h-[28px] rounded border border-ink-200 text-ink-500 hover:border-accent-300 leading-none">−</button>
                          <span className="text-[10px] text-ink-500 tabular-nums w-14 text-center">{count}× {it.ingredient.serving_label.replace(/^1\s*/, '')}</span>
                          <button type="button" aria-label="one more" onClick={() => setGrams(i, String((count + 1) * sg))}
                            className="min-w-[28px] min-h-[28px] rounded border border-ink-200 text-ink-500 hover:border-accent-300 leading-none">+</button>
                        </div>
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

                {/* Save the whole basket as a reusable NAMED meal (a recipe). */}
                <div className="flex items-center gap-1.5 pt-1.5 mt-0.5 border-t border-ink-100">
                  <input value={mealName} onChange={e => setMealName(e.target.value)}
                    placeholder="Name this meal to save it (optional)"
                    className="flex-1 min-w-0 min-h-[36px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
                  <button type="button" onClick={handleSaveAsMeal} disabled={!mealName.trim() || createRecipe.isPending}
                    className="shrink-0 min-h-[36px] px-3 rounded-lg text-xs font-semibold border border-accent-300 text-accent-700 bg-accent-50/50 hover:bg-accent-50 disabled:opacity-50 transition-colors">
                    💾 Save as meal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer — live totals + how this meal closes the day's gap + save */}
          <div className="px-5 py-3.5 border-t border-ink-100 flex items-center gap-3 sticky bottom-0 bg-cream-50">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-700 tabular-nums">
                <strong className="text-ink-900">{Math.round(totals.kcal)}</strong> kcal
                <span className="text-ink-300"> · </span>
                <strong className="text-ink-900">{Math.round(totals.prot)}</strong> g protein
              </p>
              {/* Remaining for the day AFTER logging this meal — the number a
                  cutting/bulking user actually steers by (dietitian ask). */}
              {(targets.protein > 0 || targets.calories > 0) && (() => {
                const protLeft = Math.round(targets.protein - (nut?.protein_g ?? 0) - totals.prot)
                const kcalLeft = Math.round(targets.calories - (nut?.calories ?? 0) - totals.kcal)
                return (
                  <p className="text-[11px] text-ink-400 tabular-nums mt-0.5">
                    After this: <span className={protLeft < 0 ? 'text-red-500' : 'text-ink-600'}>{protLeft >= 0 ? `${protLeft}g protein left` : `${-protLeft}g protein over`}</span>
                    <span className="text-ink-300"> · </span>
                    <span className={kcalLeft < 0 ? 'text-red-500' : 'text-ink-600'}>{kcalLeft >= 0 ? `${kcalLeft} kcal left` : `${-kcalLeft} over`}</span>
                  </p>
                )
              })()}
            </div>
            <button type="button" onClick={handleSave} disabled={basket.length === 0 || addEntries.isPending}
              className="min-h-[44px] px-5 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors">
              {addEntries.isPending ? 'Saving…' : `Log ${basket.length || ''} item${basket.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </DialogPanel>
      </div>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />
    </Dialog>
  )
}
