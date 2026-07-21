import { useMemo, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useIngredientLibrary, useCreateIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries, useRecentFoods } from '../hooks/useFoodLog'
import { useQueryClient } from '@tanstack/react-query'
import { useRecipes, useCreateRecipe } from '../hooks/useRecipes'
import { ingredientSnapshot, recipeSnapshot, type RecentFood } from '../api/foodLogApi'
import { upsertExternalFood } from '../api/ingredientLibraryApi'
import { lookupBarcode, type BarcodeProduct } from '../api/openFoodFactsApi'
import { BarcodeScanner } from './BarcodeScanner'
import { OnlineFoodSearch } from './OnlineFoodSearch'
import { MealPortionPicker } from './MealPortionPicker'
import { SlotSelect, FoodThumb } from './foodLogKit'
import { sanitizeDecimal } from './foodLogUtils'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { toast } from '../../../app/store'
import type { IngredientLibraryItem, FoodLogEntryInput, MealSlot, RecipeWithIngredients } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  LOG FOOD — full-screen, calm, visual (2026-07-21 redesign, user brief:
//  "baştan sona mükemmel bir UI/UX; basit, sade, şık; tam ekran; görselli").
//
//  Structure (fixed rows, only the middle scrolls — nothing ever jumps):
//    HEADER  one row: ✕ · title+date · slot DROPDOWN (was a 5-pill row)
//    SEARCH  one row: big input with 📷 / 🌐 inline
//    BODY    (scroll) idle → Recents photo-grid + Saved-meals strip
//                     typing → clean result rows (+ create row)
//    BASKET  (own scroll, appears when items exist) — compact editable rows
//    FOOTER  one row: totals + remaining · Log button
//
//  Saves into food_log_entries (macros snapshotted at log time). A brand-new
//  food is added to the library inline ONCE and is a 3-tap food forever after.
// ─────────────────────────────────────────────────────────────────────────────

function slotForNow(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

interface BasketItem { ingredient: IngredientLibraryItem; grams: number }

interface Props {
  open:          boolean
  onClose:       () => void
  date:          string
  defaultSlot?:  MealSlot
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
  const [mealServings, setMealServings] = useState('1')
  const [saveMealOpen, setSaveMealOpen] = useState(false)
  const [portionRecipe, setPortionRecipe] = useState<RecipeWithIngredients | null>(null)

  // Re-seed per open (instance is reused) — sanctioned adjust-during-render.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSlot(defaultSlot ?? slotForNow())
      setQuery(defaultQuery ?? '')
      setMealName(''); setMealServings('1'); setPortionRecipe(null); setSaveMealOpen(false)
    }
  }

  const [basket, setBasket] = useState<BasketItem[]>([])
  const [showNew, setShowNew] = useState(false)
  const [nName, setNName] = useState('')
  const [nKcal, setNKcal] = useState(''); const [nProt, setNProt] = useState('')
  const [nCarb, setNCarb] = useState(''); const [nFat, setNFat] = useState('')
  const [nFiber, setNFiber] = useState('')
  const [nServLabel, setNServLabel] = useState(''); const [nServGrams, setNServGrams] = useState('')

  const [scanOpen, setScanOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [onlineOpen, setOnlineOpen] = useState(false)
  const [scanMeta, setScanMeta] = useState<{ source: string; source_ref: string; image_url: string | null } | null>(null)

  function prefillFromProduct(p: BarcodeProduct) {
    setNName(p.name)
    setNKcal(p.calories != null ? String(p.calories) : '')
    setNProt(p.protein_g != null ? String(p.protein_g) : '')
    setNCarb(p.carbs_g != null ? String(p.carbs_g) : '')
    setNFat(p.fat_g != null ? String(p.fat_g) : '')
    setNFiber(p.fiber_g != null ? String(p.fiber_g) : '')
    setNServLabel(p.serving_grams != null ? '1 serving' : '')
    setNServGrams(p.serving_grams != null ? String(p.serving_grams) : '')
    setScanMeta({ source: p.source ?? 'openfoodfacts', source_ref: p.code, image_url: p.image_url })
    setShowNew(true)
    setOnlineOpen(false)
  }

  async function handleBarcode(code: string) {
    setScanOpen(false); setScanning(true)
    const tid = toast.loading('Looking up barcode…')
    try {
      const p = await lookupBarcode(code)
      toast.dismiss(tid)
      if (!p) { toast.error('Product not found in Open Food Facts'); return }
      const existing = library.find(i => i.name.toLowerCase() === p.name.toLowerCase())
      if (existing) { addToBasket(existing); toast.success(`${p.name} — already in your library ✓`); return }
      prefillFromProduct(p)
      toast.success(`Found: ${p.name} — review & add`)
    } catch {
      toast.dismiss(tid); toast.error('Barcode lookup failed')
    } finally { setScanning(false) }
  }

  function addRecent(r: RecentFood) {
    const lib = r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) : null
    if (lib) { addToBasket(lib); return }
    addEntries.mutate([{
      date, meal_slot: slot,
      library_ingredient_id: r.library_ingredient_id, recipe_id: r.recipe_id, custom_title: r.custom_title,
      quantity: r.quantity, unit: r.unit,
      calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g, sugar_g: r.sugar_g,
    }], { onSuccess: () => toast.success(`${r.title ?? 'Food'} logged ✓`) })
  }

  function logRecipe(rec: RecipeWithIngredients, servingsEaten: number) {
    addEntries.mutate(
      [{ date, meal_slot: slot, recipe_id: rec.id, quantity: servingsEaten, unit: 'serving', ...recipeSnapshot(rec, servingsEaten) }],
      { onSuccess: onClose },
    )
  }

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? library.filter(i => i.name.toLowerCase().includes(q)) : []).slice(0, 20),
    [library, q],
  )
  // Recents enriched with their library row (photo / group / serving preset).
  const recentTiles = useMemo(
    () => recents.slice(0, 12).map(r => ({
      r, lib: r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) ?? null : null,
    })),
    [recents, library],
  )
  const savedMeals = useMemo(
    () => recipes.filter(r => !q || r.title.toLowerCase().includes(q)).slice(0, 8),
    [recipes, q],
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
    const input = {
      name: nName, calories: num(nKcal), protein_g: num(nProt), carbs_g: num(nCarb),
      fat_g: num(nFat), fiber_g: num(nFiber),
      serving_label: nServLabel || null, serving_grams: num(nServGrams),
    }
    try {
      let created
      if (scanMeta) {
        created = await upsertExternalFood({ ...input, source: scanMeta.source, source_ref: scanMeta.source_ref, image_url: scanMeta.image_url })
        qc.invalidateQueries({ queryKey: ['recipe-ingredient-library'] })
      } else {
        created = await createIngredient.mutateAsync(input)
      }
      addToBasket(created)
      setShowNew(false); setScanMeta(null)
      setNName(''); setNKcal(''); setNProt(''); setNCarb(''); setNFat(''); setNFiber(''); setNServLabel(''); setNServGrams('')
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not save the ingredient')
    }
  }

  async function handleSave() {
    if (basket.length === 0) return
    const entries: FoodLogEntryInput[] = basket.map(it => ({
      date, meal_slot: slot, library_ingredient_id: it.ingredient.id,
      quantity: it.grams, unit: 'g', ...ingredientSnapshot(it.ingredient, it.grams),
    }))
    await addEntries.mutateAsync(entries)
    setBasket([])
    onClose()
  }

  async function handleSaveMeal() {
    if (basket.length === 0 || !mealName.trim()) return
    const servingsN = Math.max(1, Number(sanitizeDecimal(mealServings)) || 1)
    const r1 = (n: number) => Math.round(n * 10) / 10
    const m = basket.reduce((a, it) => {
      const s = ingredientSnapshot(it.ingredient, it.grams)
      return { calories: a.calories + (s.calories ?? 0), protein_g: a.protein_g + (s.protein_g ?? 0), carbs_g: a.carbs_g + (s.carbs_g ?? 0), fat_g: a.fat_g + (s.fat_g ?? 0), fiber_g: a.fiber_g + (s.fiber_g ?? 0), sugar_g: a.sugar_g + (s.sugar_g ?? 0) }
    }, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 })
    const per = (v: number) => r1(v / servingsN)
    const tid = toast.loading('Saving meal…')
    try {
      await createRecipe.mutateAsync({
        title: mealName.trim(), servings: servingsN, macro_mode: 'manual',
        calories: per(m.calories), protein_g: per(m.protein_g), carbs_g: per(m.carbs_g), fat_g: per(m.fat_g), fiber_g: per(m.fiber_g), sugar_g: per(m.sugar_g),
        ingredients: basket.map(it => ({ name: it.ingredient.name, quantity: it.grams, unit: 'g', note: null, library_ingredient_id: it.ingredient.id })),
      })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      toast.dismiss(tid)
      toast.success(`Saved "${mealName.trim()}" ✓ — log it anytime from Saved meals`)
      setMealName(''); setMealServings('1'); setSaveMealOpen(false)
    } catch (e) { toast.dismiss(tid); toast.error((e as Error).message ?? 'Failed') }
  }

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const inputCls = 'min-h-[44px] px-3 text-sm border border-ink-200 rounded-xl bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'
  const protLeft = Math.round(targets.protein - (nut?.protein_g ?? 0) - totals.prot)
  const kcalLeft = Math.round(targets.calories - (nut?.calories ?? 0) - totals.kcal)

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/40 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-stretch sm:items-center justify-center sm:p-4">
        {/* FULL-SCREEN on phones; a tall fixed-height sheet on desktop. The
            panel is a flex COLUMN of fixed bands — only the body scrolls. */}
        {/* Safe-area: on true full-screen (phone) the panel must pad its top
            for the iOS PWA notch/status bar (edge-to-edge mode) — without it
            the header row sits under the clock. */}
        <DialogPanel
          transition
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
          className="w-full h-full sm:h-[min(780px,94vh)] sm:max-w-2xl sm:rounded-3xl bg-cream-50 sm:border border-ink-200 sm:shadow-card-hover flex flex-col overflow-hidden transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-6 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">

          {/* ── HEADER — one calm row ── */}
          <div className="shrink-0 h-14 px-2 sm:px-3 flex items-center gap-1 border-b border-ink-100">
            <button type="button" onClick={onClose} aria-label="Close"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-ink-400 hover:text-ink-700 hover:bg-ink-100 text-xl leading-none">×</button>
            <div className="flex-1 min-w-0 px-1">
              <p className="text-[15px] font-bold text-ink-900 leading-tight">Log food</p>
              <p className="text-[11px] text-ink-400 leading-tight">{dateLabel}</p>
            </div>
            <SlotSelect value={slot} onChange={setSlot} />
          </div>

          {/* ── SEARCH — one row, tools inline ── */}
          <div className="shrink-0 px-4 pt-3 pb-2">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300 pointer-events-none">🔍</span>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search food…"
                className="w-full min-h-[48px] pl-10 pr-24 text-sm border border-ink-200 rounded-2xl bg-cream-100/70 focus:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 transition-colors"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-0.5">
                <button type="button" onClick={() => setScanOpen(true)} disabled={scanning}
                  className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 disabled:opacity-50"
                  title="Scan barcode" aria-label="Scan barcode">📷</button>
                <button type="button" onClick={() => setOnlineOpen(o => !o)}
                  className={`min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-lg ${onlineOpen ? 'bg-accent-100 text-accent-700' : 'text-ink-400 hover:text-ink-700 hover:bg-ink-100'}`}
                  title="Search online" aria-label="Search online">🌐</button>
              </div>
            </div>
          </div>

          {/* ── BODY — the only scrolling band ── */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-4">

            {onlineOpen && (
              <div className="rounded-2xl border border-accent-200 bg-accent-50/40 p-3">
                <OnlineFoodSearch initialQuery={query} onPick={prefillFromProduct} />
              </div>
            )}

            {portionRecipe && (
              <MealPortionPicker
                recipe={portionRecipe}
                busy={addEntries.isPending}
                onCancel={() => setPortionRecipe(null)}
                onLog={servingsEaten => logRecipe(portionRecipe, servingsEaten)}
              />
            )}

            {showNew && (
              <div className="rounded-2xl border border-accent-200 bg-accent-50/40 p-3.5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {scanMeta?.image_url && <FoodThumb name={nName} imageUrl={scanMeta.image_url} size={36} />}
                  <p className="text-xs font-semibold text-accent-700">New ingredient · per 100g (one-time — reusable forever)</p>
                </div>
                <input value={nName} onChange={e => setNName(e.target.value)} placeholder="Name" className={inputCls} />
                <div className="grid grid-cols-3 gap-1.5">
                  <input value={nKcal}  onChange={e => setNKcal(sanitizeDecimal(e.target.value))}  inputMode="decimal" placeholder="kcal" className={inputCls} />
                  <input value={nProt}  onChange={e => setNProt(sanitizeDecimal(e.target.value))}  inputMode="decimal" placeholder="Protein" className={inputCls} />
                  <input value={nCarb}  onChange={e => setNCarb(sanitizeDecimal(e.target.value))}  inputMode="decimal" placeholder="Carbs" className={inputCls} />
                  <input value={nFat}   onChange={e => setNFat(sanitizeDecimal(e.target.value))}   inputMode="decimal" placeholder="Fat" className={inputCls} />
                  <input value={nFiber} onChange={e => setNFiber(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fiber" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={nServLabel} onChange={e => setNServLabel(e.target.value)} placeholder="Portion label (1 scoop)" className={inputCls} />
                  <input value={nServGrams} onChange={e => setNServGrams(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams" className={inputCls} />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowNew(false); setScanMeta(null) }}
                    className="min-h-[44px] px-3 rounded-xl text-xs text-ink-500 hover:bg-ink-100">Cancel</button>
                  <button type="button" onClick={handleNewIngredient} disabled={createIngredient.isPending || !nName.trim()}
                    className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
                    {createIngredient.isPending ? 'Adding…' : 'Add to meal'}
                  </button>
                </div>
              </div>
            )}

            {q ? (
              /* ── SEARCHING → clean result rows ── */
              <div className="flex flex-col">
                {matches.map(ing => (
                  <button key={ing.id} type="button" onClick={() => addToBasket(ing)}
                    className="flex items-center gap-3 min-h-[56px] px-1 rounded-xl hover:bg-cream-100 active:bg-cream-100 transition-colors text-left">
                    <FoodThumb name={ing.name} group={ing.food_group} imageUrl={ing.image_url} size={40} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink-800 truncate">{ing.name}</span>
                      <span className="block text-[11px] text-ink-400">
                        {ing.calories != null && `${Math.round(ing.calories)} kcal · 100g`}
                        {ing.serving_label && ` · ${ing.serving_label}`}
                      </span>
                    </span>
                    <span className="min-w-[36px] min-h-[36px] rounded-full bg-accent-50 text-accent-600 grid place-items-center text-lg shrink-0">+</span>
                  </button>
                ))}
                {savedMeals.length > 0 && matches.length === 0 && savedMeals.map(r => (
                  <button key={r.id} type="button" onClick={() => setPortionRecipe(r)}
                    className="flex items-center gap-3 min-h-[56px] px-1 rounded-xl hover:bg-cream-100 transition-colors text-left">
                    <FoodThumb name={r.title} imageUrl={r.image_url} size={40} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink-800 truncate">🍲 {r.title}</span>
                      <span className="block text-[11px] text-ink-400">{r.calories != null && `${Math.round(r.calories)} kcal / portion`}</span>
                    </span>
                    <span className="text-[11px] text-accent-600 shrink-0">portion →</span>
                  </button>
                ))}
                <button type="button" onClick={() => { setShowNew(true); setNName(query.trim()) }}
                  className="flex items-center gap-3 min-h-[52px] px-1 rounded-xl hover:bg-accent-50/60 transition-colors text-left">
                  <span className="w-10 h-10 rounded-lg border border-dashed border-accent-300 grid place-items-center text-accent-500 text-lg shrink-0">＋</span>
                  <span className="text-sm text-accent-700">Create “{query.trim()}”…</span>
                </button>
              </div>
            ) : (
              /* ── IDLE → visual recents grid + saved meals strip ── */
              <>
                {recentTiles.length > 0 && (
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Recent</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {recentTiles.map(({ r, lib }) => (
                        <button key={r.key} type="button" onClick={() => addRecent(r)}
                          className="rounded-2xl border border-ink-100 bg-cream-100/50 hover:border-accent-300 hover:bg-cream-100 transition-colors p-2 flex flex-col items-center gap-1.5 min-h-[96px] press-feedback">
                          <FoodThumb name={r.title} group={lib?.food_group} imageUrl={lib?.image_url} size={44} />
                          <span className="text-[11px] font-medium text-ink-700 leading-tight text-center line-clamp-2 w-full">{r.title}</span>
                          {r.calories != null && r.calories > 0 && (
                            <span className="text-[10px] text-ink-400 tabular-nums">{Math.round(r.calories)} kcal</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {savedMeals.length > 0 && (
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-2">Saved meals</p>
                    <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-1 px-1 pb-1 snap-x">
                      {savedMeals.map(r => (
                        <button key={r.id} type="button" onClick={() => setPortionRecipe(r)}
                          className={`snap-start shrink-0 w-36 rounded-2xl border p-2.5 flex flex-col items-start gap-1 text-left transition-colors press-feedback ${
                            portionRecipe?.id === r.id ? 'border-accent-400 bg-accent-50/60' : 'border-ink-100 bg-cream-100/50 hover:border-accent-300'
                          }`}>
                          <FoodThumb name={r.title} imageUrl={r.image_url} size={36} />
                          <span className="text-[12px] font-medium text-ink-800 leading-tight line-clamp-2">{r.title}</span>
                          <span className="text-[10px] text-ink-400 tabular-nums">
                            {r.calories != null && `${Math.round(r.calories)} kcal`}{r.servings > 1 && ` · ${r.servings} portions`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {recentTiles.length === 0 && savedMeals.length === 0 && (
                  <div className="flex-1 grid place-items-center text-center py-10">
                    <div>
                      <p className="text-3xl mb-2">🍽️</p>
                      <p className="text-sm text-ink-500">Search a food above, scan a barcode,</p>
                      <p className="text-sm text-ink-500">or create your first ingredient.</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── BASKET — appears with items; its own scroll, body stays put ── */}
          {basket.length > 0 && (
            <div className="shrink-0 border-t border-ink-100 bg-cream-100/40">
              <div className="max-h-56 overflow-y-auto px-4 py-2 flex flex-col gap-0.5">
                <div className="flex items-center justify-between min-h-[28px]">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">This meal · {basket.length}</p>
                  <button type="button" onClick={() => setSaveMealOpen(v => !v)}
                    className="text-[11px] text-ink-400 hover:text-accent-600 min-h-[28px] px-1">💾 Save as meal</button>
                </div>
                {basket.map((it, i) => {
                  const s = ingredientSnapshot(it.ingredient, it.grams)
                  const sg = it.ingredient.serving_grams
                  const count = sg ? Math.max(1, Math.round(it.grams / sg)) : 1
                  return (
                    <div key={`${it.ingredient.id}-${i}`} className="flex items-center gap-2 min-h-[48px]">
                      <FoodThumb name={it.ingredient.name} group={it.ingredient.food_group} imageUrl={it.ingredient.image_url} size={32} />
                      <span className="text-sm text-ink-800 flex-1 min-w-0 truncate">{it.ingredient.name}</span>
                      {it.ingredient.serving_label && sg != null && (
                        <div className="flex items-center shrink-0">
                          <button type="button" aria-label="one less" onClick={() => setGrams(i, String(Math.max(1, count - 1) * sg))}
                            className="min-w-[32px] min-h-[32px] rounded-lg text-ink-400 hover:bg-ink-100 leading-none">−</button>
                          <span className="text-[10px] text-ink-500 tabular-nums w-12 text-center">{count}×{it.ingredient.serving_label.replace(/^1\s*/, '')}</span>
                          <button type="button" aria-label="one more" onClick={() => setGrams(i, String((count + 1) * sg))}
                            className="min-w-[32px] min-h-[32px] rounded-lg text-ink-400 hover:bg-ink-100 leading-none">+</button>
                        </div>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        <input value={it.grams || ''} onChange={e => setGrams(i, e.target.value)} inputMode="decimal"
                          className="w-14 min-h-[36px] px-1.5 text-sm text-right border border-ink-200 rounded-lg bg-cream-50 tabular-nums" />
                        <span className="text-[10px] text-ink-400">g</span>
                      </div>
                      <span className="text-[11px] text-ink-500 tabular-nums w-14 text-right shrink-0">{Math.round(s.calories ?? 0)} kcal</span>
                      <button type="button" onClick={() => setBasket(b => b.filter((_, j) => j !== i))}
                        aria-label={`Remove ${it.ingredient.name}`}
                        className="min-w-[32px] min-h-[32px] rounded-lg flex items-center justify-center text-ink-300 hover:text-red-500 hover:bg-red-50 shrink-0">×</button>
                    </div>
                  )
                })}
                {saveMealOpen && (
                  <div className="flex items-center gap-1.5 pt-1.5 pb-1 border-t border-ink-100 mt-1">
                    <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="Meal name…"
                      className="flex-1 min-w-0 min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-xl bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400" />
                    <input value={mealServings} onChange={e => setMealServings(sanitizeDecimal(e.target.value))} inputMode="decimal"
                      title="How many portions this batch makes"
                      className="w-12 min-h-[40px] px-1 text-sm text-center border border-ink-200 rounded-xl bg-cream-50 tabular-nums" />
                    <span className="text-[10px] text-ink-400 shrink-0">portions</span>
                    <button type="button" onClick={handleSaveMeal} disabled={!mealName.trim() || createRecipe.isPending}
                      className="shrink-0 min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-accent-300 text-accent-700 bg-accent-50/50 hover:bg-accent-50 disabled:opacity-50">Save</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── FOOTER — one tight row ── */}
          <div className="shrink-0 h-[68px] px-4 border-t border-ink-100 bg-cream-50 flex items-center gap-3"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex-1 min-w-0 leading-tight">
              <p className="text-sm text-ink-900 tabular-nums font-bold">
                {Math.round(totals.kcal)} <span className="font-normal text-ink-400">kcal</span>
                <span className="text-ink-300 font-normal"> · </span>
                {Math.round(totals.prot)}<span className="font-normal text-ink-400">g protein</span>
              </p>
              {(targets.protein > 0 || targets.calories > 0) && (
                <p className="text-[11px] text-ink-400 tabular-nums truncate">
                  after: <span className={protLeft < 0 ? 'text-red-500' : ''}>{protLeft >= 0 ? `${protLeft}g P left` : `${-protLeft}g P over`}</span>
                  {' · '}
                  <span className={kcalLeft < 0 ? 'text-red-500' : ''}>{kcalLeft >= 0 ? `${kcalLeft} kcal left` : `${-kcalLeft} over`}</span>
                </p>
              )}
            </div>
            <button type="button" onClick={handleSave} disabled={basket.length === 0 || addEntries.isPending}
              className="min-h-[48px] px-6 rounded-2xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-40 transition-colors shrink-0">
              {addEntries.isPending ? 'Saving…' : basket.length > 0 ? `Log ${basket.length}` : 'Log'}
            </button>
          </div>
        </DialogPanel>
      </div>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />
    </Dialog>
  )
}
