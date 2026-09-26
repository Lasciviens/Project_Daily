import { useMemo, useState, type ReactNode } from 'react'
import { Camera, ChevronRight, Globe, Minus, Plus, Save, Search, Star, X } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Button, IconButton } from '../../../shared/ui'
import { cx } from '../../../shared/ui/cx'
import { useIngredientLibrary, useCreateIngredientLibraryItem, useUpsertExternalFood } from '../hooks/useIngredientLibrary'
import {
  useAddFoodLogEntries, useRecentFoods, useFoodFavorites, useAddFoodFavorite, useRemoveFoodFavorite, useHideRecentFood,
} from '../hooks/useFoodLog'
import { useRecipes, useCreateRecipe } from '../hooks/useRecipes'
import { ingredientSnapshot, recipeSnapshot, type RecentFood } from '../api/foodLogApi'
import { lookupBarcode, type BarcodeProduct } from '../api/openFoodFactsApi'
import { BarcodeScanner } from './BarcodeScanner'
import { OnlineFoodSearch } from './OnlineFoodSearch'
import { MealPortionPicker } from './MealPortionPicker'
import { SlotSelect, FoodThumb, FoodTile } from './foodLogKit'
import { sanitizeDecimal } from './foodLogUtils'
import { MacroWarningBadge } from './MacroWarningBadge'
import { checkMacroConsistency } from '../macroSanity'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { toast } from '../../../app/store'
import type { IngredientLibraryItem, FoodLogEntryInput, MealSlot, RecipeWithIngredients } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
//  LOG FOOD — full-screen, calm, visual (2026-07-21 redesign, user brief:
//  "baştan sona mükemmel bir UI/UX; basit, sade, şık; tam ekran; görselli").
//
//  Structure (ModalShell, full screen on phones — only the middle scrolls):
//    HEADER  title + date · slot dropdown
//    SEARCH  sticky at the top of the body: input with scan / online inline
//    BODY    idle → Favourites + Recents photo grids + Saved-meals strip
//            typing → clean result rows (+ create row)
//    FOOTER  basket (own scroll, appears when items exist) + totals · Log
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
  /** Controlled callers pass it; the `food-log` entity modal omits it. */
  open?:         boolean
  onClose:       () => void
  date:          string
  defaultSlot?:  MealSlot
  defaultQuery?: string
  /** ✎ on a saved meal. Defaults to the shared `recipe` editor popup. */
  onEditRecipe?: (r: RecipeWithIngredients) => void
}

const openRecipeEditor = (r: RecipeWithIngredients) => entityModal.open({ kind: 'recipe', id: r.id })

export function FoodLogModal({ open = true, onClose, date, defaultSlot, defaultQuery, onEditRecipe = openRecipeEditor }: Props) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recents = [] } = useRecentFoods()
  const { data: favorites = [] } = useFoodFavorites()
  const { data: recipes = [] } = useRecipes()
  const createIngredient = useCreateIngredientLibraryItem()
  const upsertExternal = useUpsertExternalFood()
  const createRecipe = useCreateRecipe()
  const addEntries = useAddFoodLogEntries()
  const addFavorite = useAddFoodFavorite()
  const removeFavorite = useRemoveFoodFavorite()
  const hideRecent = useHideRecentFood()
  const { data: nut } = useDayNutrition(date)
  const { targets } = useDayTargets()

  const [slot, setSlot] = useState<MealSlot>(defaultSlot ?? slotForNow())
  const [query, setQuery] = useState(defaultQuery ?? '')
  const [mealName, setMealName] = useState('')
  const [mealServings, setMealServings] = useState('1')
  const [saveMealOpen, setSaveMealOpen] = useState(false)
  // A saved meal defaults to TEMP (a one-off named meal, hidden from the recipe
  // Library) — tick "Save to library" to make it a permanent Library recipe.
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  const [portionRecipe, setPortionRecipe] = useState<RecipeWithIngredients | null>(null)
  // "As meal" — logging several basket items together collapses them into
  // ONE compact diary line (shared meal_group_id) instead of N separate rows;
  // tapping that line later expands to each item's own details. Default on:
  // the whole point is a fast multi-item lunch log that doesn't read as a
  // wall of separate rows in the day view.
  const [asMeal, setAsMeal] = useState(true)
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [recentOpen, setRecentOpen] = useState(true)

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
  const [nSugar, setNSugar] = useState('')
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
    setNSugar(p.sugar_g != null ? String(p.sugar_g) : '')
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
      if (existing) { addToBasket(existing); toast.success(`${p.name} — already in your library`); return }
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
    }])
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
  // Recents/Favourites enriched with their library row (photo / group / serving
  // preset) — Favourites don't store an image of their own, so this is how a
  // favourited library ingredient still gets a real photo instead of a
  // fallback emoji.
  const recentTiles = useMemo(
    () => recents.slice(0, 12).map(r => ({
      r, lib: r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) ?? null : null,
    })),
    [recents, library],
  )
  const favoriteTiles = useMemo(
    () => favorites.map(r => ({
      r, lib: r.library_ingredient_id ? library.find(l => l.id === r.library_ingredient_id) ?? null : null,
    })),
    [favorites, library],
  )
  const favoriteKeys = useMemo(() => new Set(favorites.map(f => f.key)), [favorites])
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
      fat_g: num(nFat), fiber_g: num(nFiber), sugar_g: num(nSugar),
      serving_label: nServLabel || null, serving_grams: num(nServGrams),
    }
    try {
      const created = scanMeta
        ? await upsertExternal.mutateAsync({ ...input, source: scanMeta.source, source_ref: scanMeta.source_ref, image_url: scanMeta.image_url })
        : await createIngredient.mutateAsync(input)
      addToBasket(created)
      setShowNew(false); setScanMeta(null)
      setNName(''); setNKcal(''); setNProt(''); setNCarb(''); setNFat(''); setNFiber(''); setNSugar(''); setNServLabel(''); setNServGrams('')
    } catch { return }   // the hook already toasted + logged
  }

  async function handleSave() {
    if (basket.length === 0) return
    // A group of ONE has nothing to compact — only tag a shared id when
    // there's actually more than one item to collapse together.
    const groupId = asMeal && basket.length > 1 ? crypto.randomUUID() : null
    const entries: FoodLogEntryInput[] = basket.map(it => ({
      date, meal_slot: slot, library_ingredient_id: it.ingredient.id,
      quantity: it.grams, unit: 'g', ...ingredientSnapshot(it.ingredient, it.grams),
      meal_group_id: groupId,
    }))
    try {
      await addEntries.mutateAsync(entries)
      setBasket([])
      onClose()
    } catch { return }   // the hook already toasted + logged
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
    try {
      await createRecipe.mutateAsync({
        title: mealName.trim(), servings: servingsN, macro_mode: 'manual',
        calories: per(m.calories), protein_g: per(m.protein_g), carbs_g: per(m.carbs_g), fat_g: per(m.fat_g), fiber_g: per(m.fiber_g), sugar_g: per(m.sugar_g),
        is_temp: !saveToLibrary,
        ingredients: basket.map(it => ({ name: it.ingredient.name, quantity: it.grams, unit: 'g', note: null, library_ingredient_id: it.ingredient.id })),
      })
      setMealName(''); setMealServings('1'); setSaveMealOpen(false); setSaveToLibrary(false)
    } catch { return }
  }

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const protLeft = Math.round(targets.protein - (nut?.protein_g ?? 0) - totals.prot)
  const kcalLeft = Math.round(targets.calories - (nut?.calories ?? 0) - totals.kcal)
  const addingIngredient = createIngredient.isPending || upsertExternal.isPending

  const sectionToggle = (isOpen: boolean, onToggle: () => void, label: ReactNode) => (
    <button type="button" onClick={onToggle} aria-expanded={isOpen}
      className="mb-2 flex min-h-[32px] items-center gap-1.5 section-label hover:text-fg-2">
      <ChevronRight className={cx('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
      {label}
    </button>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Log food"
      subtitle={dateLabel}
      headerActions={<SlotSelect value={slot} onChange={setSlot} />}
      size="lg"
      mobile="fullscreen"
      panelClassName="sm:!h-[min(780px,88dvh)]"
      bodyClassName="flex flex-col gap-4 px-4 pb-4"
      footer={
        <div className="flex flex-col gap-2">
          {basket.length > 0 && (
            <div className="-mx-4 -mt-3 max-h-56 overflow-y-auto border-b border-line bg-surface-2 px-4 py-2 sm:-mx-5 sm:px-5">
              <div className="flex min-h-[32px] items-center justify-between gap-2">
                <p className="section-label shrink-0">This meal · {basket.length}</p>
                <div className="flex shrink-0 items-center gap-2">
                  {basket.length > 1 && (
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-meta text-fg-muted"
                      title="Log these items as one compact line in the day view — tap it later to see each item's own details.">
                      <input type="checkbox" checked={asMeal} onChange={e => setAsMeal(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                      As meal
                    </label>
                  )}
                  <Button variant="ghost" size="sm" icon={<Save />} onClick={() => setSaveMealOpen(v => !v)} aria-expanded={saveMealOpen}>
                    Save as meal
                  </Button>
                </div>
              </div>
              {basket.map((it, i) => {
                const snap = ingredientSnapshot(it.ingredient, it.grams)
                const sg = it.ingredient.serving_grams
                const count = sg ? Math.max(1, Math.round(it.grams / sg)) : 1
                return (
                  <div key={`${it.ingredient.id}-${i}`} className="flex min-h-[48px] items-center gap-2">
                    <FoodThumb name={it.ingredient.name} group={it.ingredient.food_group} imageUrl={it.ingredient.image_url} size={32} />
                    <span className="min-w-0 flex-1 truncate text-body text-fg">{it.ingredient.name}</span>
                    {it.ingredient.serving_label && sg != null && (
                      <div className="flex shrink-0 items-center">
                        <IconButton label="One less" className="h-9 w-9" onClick={() => setGrams(i, String(Math.max(1, count - 1) * sg))}><Minus /></IconButton>
                        <span className="w-12 text-center text-micro normal-case tracking-normal text-fg-muted tabular-nums">{count}×{it.ingredient.serving_label.replace(/^1\s*/, '')}</span>
                        <IconButton label="One more" className="h-9 w-9" onClick={() => setGrams(i, String((count + 1) * sg))}><Plus /></IconButton>
                      </div>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      <input value={it.grams || ''} onChange={e => setGrams(i, e.target.value)} inputMode="decimal" aria-label={`${it.ingredient.name} grams`}
                        className="input w-16 px-1.5 text-right tabular-nums" />
                      <span className="text-meta text-fg-muted">g</span>
                    </div>
                    <span className="w-14 shrink-0 text-right text-meta text-fg-muted tabular-nums">{Math.round(snap.calories ?? 0)} kcal</span>
                    <IconButton label={`Remove ${it.ingredient.name}`} className="h-9 w-9 text-fg-faint hover:text-danger"
                      onClick={() => setBasket(b => b.filter((_, j) => j !== i))}><X /></IconButton>
                  </div>
                )
              })}
              {saveMealOpen && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-line pb-1 pt-2">
                  <input value={mealName} onChange={e => setMealName(e.target.value)} placeholder="Meal name…" aria-label="Meal name"
                    className="input min-w-0 flex-1" />
                  <input value={mealServings} onChange={e => setMealServings(sanitizeDecimal(e.target.value))} inputMode="decimal"
                    aria-label="Portions this batch makes" title="How many portions this batch makes"
                    className="input w-14 px-1 text-center tabular-nums" />
                  <span className="shrink-0 text-meta text-fg-muted">portions</span>
                  <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-meta text-fg-muted"
                    title="Add to your recipe Library. Off = a temp meal: reusable and editable, but hidden from the Library grid.">
                    <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                    Library
                  </label>
                  <Button size="sm" onClick={handleSaveMeal} loading={createRecipe.isPending} disabled={!mealName.trim()}>Save</Button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-ui font-bold text-fg tabular-nums">
                {Math.round(totals.kcal)} <span className="font-normal text-fg-muted">kcal</span>
                <span className="font-normal text-fg-faint"> · </span>
                {Math.round(totals.prot)}<span className="font-normal text-fg-muted">g protein</span>
              </p>
              {(targets.protein > 0 || targets.calories > 0) && (
                <p className="truncate text-meta text-fg-muted tabular-nums">
                  After: <span className={cx(protLeft < 0 && 'text-danger')}>{protLeft >= 0 ? `${protLeft}g protein left` : `${-protLeft}g protein over`}</span>
                  {' · '}
                  <span className={cx(kcalLeft < 0 && 'text-danger')}>{kcalLeft >= 0 ? `${kcalLeft} kcal left` : `${-kcalLeft} kcal over`}</span>
                </p>
              )}
            </div>
            <Button variant="primary" onClick={handleSave} loading={addEntries.isPending} disabled={basket.length === 0} className="shrink-0 px-6">
              {basket.length > 0 ? `Log ${basket.length}` : 'Log'}
            </Button>
          </div>
        </div>
      }
    >
      {/* Search — sticky so it never scrolls away from the results. */}
      <div className="sticky top-0 z-[1] -mx-4 bg-surface px-4 pb-1 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" aria-hidden />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search food…"
            aria-label="Search food"
            className="input min-h-[48px] pl-10 pr-24"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
            <IconButton label="Scan barcode" onClick={() => setScanOpen(true)} disabled={scanning}><Camera /></IconButton>
            <IconButton label="Search online" onClick={() => setOnlineOpen(o => !o)} aria-pressed={onlineOpen}
              className={cx(onlineOpen && 'bg-accent-50 text-accent-700')}><Globe /></IconButton>
          </div>
        </div>
      </div>

      {onlineOpen && (
        <div className="rounded-card border border-accent-500/25 bg-accent-50 p-3">
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
        <div className="flex flex-col gap-2 rounded-card border border-accent-500/25 bg-accent-50 p-3.5">
          <div className="flex items-center gap-2">
            {scanMeta?.image_url && <FoodThumb name={nName} imageUrl={scanMeta.image_url} size={36} />}
            <p className="text-meta font-semibold text-accent-700">New ingredient · per 100g (one-time — reusable forever)</p>
          </div>
          <input value={nName} onChange={e => setNName(e.target.value)} placeholder="Name" aria-label="Name" className="input" />
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { v: nKcal, set: setNKcal, ph: 'kcal' },
              { v: nProt, set: setNProt, ph: 'Protein' },
              { v: nCarb, set: setNCarb, ph: 'Carbs' },
              { v: nFat, set: setNFat, ph: 'Fat' },
              { v: nFiber, set: setNFiber, ph: 'Fiber' },
              { v: nSugar, set: setNSugar, ph: 'Sugar' },
            ].map(m => (
              <input key={m.ph} value={m.v} onChange={e => m.set(sanitizeDecimal(e.target.value))} inputMode="decimal"
                placeholder={m.ph} aria-label={m.ph} className="input tabular-nums" />
            ))}
          </div>
          {(() => {
            const num = (v: string) => (v === '' ? null : Number(v))
            const check = checkMacroConsistency(num(nKcal), num(nProt), num(nCarb), num(nFat))
            return check?.inconsistent ? (
              <div data-tone="warn" className="tone-text flex items-center gap-1.5 text-meta">
                <MacroWarningBadge result={check} />
                <span>Calories don't match protein/carbs/fat — {check.deltaPct}% off. Tap the badge for details.</span>
              </div>
            ) : null
          })()}
          <div className="grid grid-cols-2 gap-1.5">
            <input value={nServLabel} onChange={e => setNServLabel(e.target.value)} placeholder="Portion label (1 scoop)" aria-label="Portion label" className="input" />
            <input value={nServGrams} onChange={e => setNServGrams(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams" aria-label="Portion grams" className="input" />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowNew(false); setScanMeta(null) }}>Cancel</Button>
            <Button variant="primary" block onClick={handleNewIngredient} loading={addingIngredient} disabled={!nName.trim()}>Add to meal</Button>
          </div>
        </div>
      )}

      {q ? (
        <div className="flex flex-col">
          {matches.map(ing => {
            const macroCheck = checkMacroConsistency(ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g)
            // A div, not a button — MacroWarningBadge is itself a Popover
            // button, and a <button> can't nest another one.
            return (
              <div key={ing.id} className="row row-interactive min-h-[56px] px-1">
                <button type="button" onClick={() => addToBasket(ing)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <FoodThumb name={ing.name} group={ing.food_group} imageUrl={ing.image_url} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-fg">{ing.name}</span>
                    <span className="block text-meta text-fg-muted">
                      {ing.calories != null && `${Math.round(ing.calories)} kcal · 100g`}
                      {ing.serving_label && ` · ${ing.serving_label}`}
                    </span>
                  </span>
                  {/* The row's visual add affordance — inside the button so tapping it adds. */}
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-600"><Plus className="h-4 w-4" aria-hidden /></span>
                </button>
                <MacroWarningBadge result={macroCheck} />
              </div>
            )
          })}
          {savedMeals.length > 0 && matches.length === 0 && savedMeals.map(r => (
            <button key={r.id} type="button" onClick={() => setPortionRecipe(r)} className="row row-interactive min-h-[56px] px-1 text-left">
              <FoodThumb name={r.title} imageUrl={r.image_url} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-fg">{r.title}</span>
                <span className="block text-meta text-fg-muted">{r.calories != null && `${Math.round(r.calories)} kcal / portion`}</span>
              </span>
              <span className="shrink-0 text-meta font-semibold text-accent-600">Portion</span>
            </button>
          ))}
          <button type="button" onClick={() => { setShowNew(true); setNName(query.trim()) }} className="row row-interactive min-h-[52px] px-1 text-left">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-dashed border-accent-500/50 text-accent-600"><Plus className="h-4 w-4" aria-hidden /></span>
            <span className="text-body text-accent-700">Create “{query.trim()}”…</span>
          </button>
        </div>
      ) : (
        <>
          {/* Favourites first — a pinned shortcut list, so it always leads. */}
          {favoriteTiles.length > 0 && (
            <section>
              {sectionToggle(favoritesOpen, () => setFavoritesOpen(v => !v), <><Star className="h-3.5 w-3.5" aria-hidden /> Favourites ({favoriteTiles.length})</>)}
              {favoritesOpen && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {favoriteTiles.map(({ r, lib }) => (
                    <FoodTile key={r.key} title={r.title} group={lib?.food_group} imageUrl={lib?.image_url}
                      calories={r.calories} sizeClass="w-9 h-9 sm:w-11 sm:h-11"
                      isFavorite onAdd={() => addRecent(r)}
                      onToggleFavorite={() => removeFavorite.mutate(r.key)} />
                  ))}
                </div>
              )}
            </section>
          )}

          {recentTiles.length > 0 && (
            <section>
              {sectionToggle(recentOpen, () => setRecentOpen(v => !v), 'Recent')}
              {recentOpen && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {recentTiles.map(({ r, lib }) => (
                    <FoodTile key={r.key} title={r.title} group={lib?.food_group} imageUrl={lib?.image_url}
                      calories={r.calories} sizeClass="w-9 h-9 sm:w-11 sm:h-11"
                      isFavorite={favoriteKeys.has(r.key)} onAdd={() => addRecent(r)}
                      onToggleFavorite={() => favoriteKeys.has(r.key) ? removeFavorite.mutate(r.key) : addFavorite.mutate(r)}
                      onHide={() => hideRecent.mutate(r.key)} />
                  ))}
                </div>
              )}
            </section>
          )}

          {savedMeals.length > 0 && (
            <section>
              <p className="section-label mb-2">Saved meals</p>
              <div className="scroll-x -mx-1 flex snap-x gap-2 px-1 pb-1">
                {savedMeals.map(r => {
                  // Hover (desktop) / the ✎ editor (mobile) reveals the meal's
                  // ingredients — a temp meal is one named unit, not N loose rows.
                  const contents = r.ingredients?.map(i => i.name).filter(Boolean).join(', ') || undefined
                  return (
                    <div key={r.id} className="relative w-36 shrink-0 snap-start">
                      <button type="button" onClick={() => setPortionRecipe(r)} title={contents}
                        className={cx(
                          'flex w-full flex-col items-start gap-1 rounded-card border p-2.5 text-left transition-colors',
                          portionRecipe?.id === r.id ? 'border-accent-500 bg-accent-50' : 'border-line bg-surface-2 hover:border-line-strong',
                        )}>
                        <FoodThumb name={r.title} imageUrl={r.image_url} size={36} />
                        <span className="line-clamp-2 pr-5 text-meta font-medium leading-tight text-fg">{r.title}</span>
                        <span className="text-micro normal-case tracking-normal text-fg-muted tabular-nums">
                          {r.calories != null && `${Math.round(r.calories)} kcal`}{r.servings > 1 && ` · ${r.servings} portions`}
                        </span>
                      </button>
                      {/* A deliberate 24px secondary action on a dense strip (see FoodTile). */}
                      <button type="button" aria-label={`Edit ${r.title}`}
                        onClick={() => { onEditRecipe(r); onClose() }}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-[11px] leading-none text-fg-muted hover:text-accent-600">✎</button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {favoriteTiles.length === 0 && recentTiles.length === 0 && savedMeals.length === 0 && (
            <div className="grid flex-1 place-items-center py-10 text-center">
              <div>
                <p className="mb-2 text-3xl">🍽️</p>
                <p className="text-body text-fg-muted">Search a food above, scan a barcode,</p>
                <p className="text-body text-fg-muted">or create your first ingredient.</p>
              </div>
            </div>
          )}
        </>
      )}

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />
    </ModalShell>
  )
}
