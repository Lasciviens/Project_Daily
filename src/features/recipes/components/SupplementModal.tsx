import { useMemo, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries, useRecentSupplements } from '../hooks/useFoodLog'
import { upsertExternalFood } from '../api/ingredientLibraryApi'
import { lookupBarcode } from '../api/openFoodFactsApi'
import { searchSupplements, fetchSupplementLabel, type SupplementHit, type SupplementActive } from '../api/supplementDsldApi'
import { BarcodeScanner } from './BarcodeScanner'
import type { IngredientLibraryItem, FoodLogEntryInput } from '../types'
import type { RecentFood } from '../api/foodLogApi'

// ─────────────────────────────────────────────────────────────────────────────
//  SUPPLEMENTS — a dedicated logger for creatine / protein powder / pre-workout
//  / vitamins, separate from the food logger (a scoop/capsule is not a plate of
//  food). Sources, in order of fit:
//   • your library (already-added supplements) — instant re-log
//   • 🔎 Online (NIH DSLD) — name search, US labels, per-serving macros + the
//     active-ingredient grams a food DB can't give (creatine 5 g/serving)
//   • 📷 barcode (Open Food Facts) — European/branded (BioTechUSA etc.)
//   • ✎ manual — anything not found
//  Always logs into the 'supplement' meal slot. Gram-based products (powders)
//  become reusable per-100g library rows; count-based ones log as a reusable
//  diary line (they reappear in Recent).
// ─────────────────────────────────────────────────────────────────────────────

interface Macros { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null }

type Selected =
  | { kind: 'grams'; libraryId?: string; name: string; source?: string; source_ref?: string; image_url?: string | null; serving_label: string | null; serving_grams: number | null; per100: Macros; actives?: SupplementActive[] }
  | { kind: 'count'; name: string; source?: string; source_ref?: string; image_url?: string | null; serving_label: string | null; perServing: Macros; actives?: SupplementActive[] }

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}
const r1 = (n: number) => Math.round(n * 10) / 10

function pickMacros(x: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null }): Macros {
  return { calories: x.calories, protein_g: x.protein_g, carbs_g: x.carbs_g, fat_g: x.fat_g, fiber_g: x.fiber_g, sugar_g: x.sugar_g }
}

interface Props { open: boolean; onClose: () => void; date: string }

export function SupplementModal({ open, onClose, date }: Props) {
  const { data: library = [] } = useIngredientLibrary()
  const { data: recents = [] } = useRecentSupplements()
  const addEntries = useAddFoodLogEntries()
  const qc = useQueryClient()

  const [mode, setMode] = useState<'library' | 'online'>('library')
  const [query, setQuery] = useState('')
  const [onlineHits, setOnlineHits] = useState<SupplementHit[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [amount, setAmount] = useState('1')     // grams (grams-kind) or count (count-kind)
  const [showManual, setShowManual] = useState(false)
  const [saving, setSaving] = useState(false)

  // Re-seed on open (instance reused across opens) — render-phase pattern.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode('library'); setQuery(''); setOnlineHits([]); setSelected(null); setAmount('1'); setShowManual(false)
    }
  }

  const libMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? library.filter(l => l.name.toLowerCase().includes(q)) : library).slice(0, 12)
  }, [library, query])

  function selectLibrary(item: IngredientLibraryItem) {
    setSelected({ kind: 'grams', libraryId: item.id, name: item.name, serving_label: item.serving_label, serving_grams: item.serving_grams, per100: pickMacros(item), image_url: item.image_url })
    setAmount(String(item.serving_grams ?? 100))
  }

  async function runOnlineSearch() {
    const q = query.trim()
    if (!q) return
    setSearching(true); setOnlineHits([])
    try {
      setOnlineHits(await searchSupplements(q))
    } catch (e) {
      toast.error((e as Error).message ?? 'Search failed')
    } finally { setSearching(false) }
  }

  async function selectOnlineHit(hit: SupplementHit) {
    setLoadingLabel(true)
    const tid = toast.loading('Loading label…')
    try {
      const p = await fetchSupplementLabel(hit.id)
      toast.dismiss(tid)
      if (p.serving_grams && p.serving_grams > 0) {
        const sg = p.serving_grams
        const per100 = (v: number | null) => (v == null ? null : r1((v / sg) * 100))
        setSelected({ kind: 'grams', name: p.name, source: p.source, source_ref: p.source_ref, image_url: p.image_url, serving_label: p.serving_label, serving_grams: sg, actives: p.actives, per100: { calories: per100(p.calories), protein_g: per100(p.protein_g), carbs_g: per100(p.carbs_g), fat_g: per100(p.fat_g), fiber_g: per100(p.fiber_g), sugar_g: per100(p.sugar_g) } })
        setAmount(String(sg))
      } else {
        setSelected({ kind: 'count', name: p.name, source: p.source, source_ref: p.source_ref, image_url: p.image_url, serving_label: p.serving_label, actives: p.actives, perServing: pickMacros(p) })
        setAmount('1')
      }
    } catch (e) {
      toast.dismiss(tid); toast.error((e as Error).message ?? 'Failed to load label')
    } finally { setLoadingLabel(false) }
  }

  async function handleBarcode(code: string) {
    setScanOpen(false)
    const tid = toast.loading('Looking up barcode…')
    try {
      const p = await lookupBarcode(code)
      toast.dismiss(tid)
      if (!p) { toast.error('Product not found in Open Food Facts'); return }
      setSelected({ kind: 'grams', name: p.name, source: 'openfoodfacts', source_ref: p.code, image_url: p.image_url, serving_label: p.serving_grams ? (p.serving_label ?? '1 serving') : p.serving_label, serving_grams: p.serving_grams, per100: pickMacros(p) })
      setAmount(String(p.serving_grams ?? 100))
      toast.success(`Found: ${p.name}`)
    } catch { toast.dismiss(tid); toast.error('Barcode lookup failed') }
  }

  function reLog(rec: RecentFood) {
    const entry: FoodLogEntryInput = {
      date, meal_slot: 'supplement',
      library_ingredient_id: rec.library_ingredient_id, recipe_id: rec.recipe_id, custom_title: rec.custom_title,
      quantity: rec.quantity, unit: rec.unit,
      calories: rec.calories, protein_g: rec.protein_g, carbs_g: rec.carbs_g, fat_g: rec.fat_g, fiber_g: rec.fiber_g, sugar_g: rec.sugar_g,
    }
    addEntries.mutate([entry], { onSuccess: onClose })
  }

  // Live snapshot for the current amount.
  const amt = Math.max(0, Number(sanitizeDecimal(amount)) || 0)
  const snapshot: Macros = useMemo(() => {
    if (!selected) return { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null }
    const scale = selected.kind === 'grams' ? amt / 100 : amt
    const src = selected.kind === 'grams' ? selected.per100 : selected.perServing
    const m = (v: number | null) => (v == null ? null : r1(v * scale))
    return { calories: m(src.calories), protein_g: m(src.protein_g), carbs_g: m(src.carbs_g), fat_g: m(src.fat_g), fiber_g: m(src.fiber_g), sugar_g: m(src.sugar_g) }
  }, [selected, amt])

  async function handleLog() {
    if (!selected || amt <= 0) return
    setSaving(true)
    const tid = toast.loading('Logging…')
    try {
      const base = { date, meal_slot: 'supplement' as const, ...snapshot }
      if (selected.kind === 'grams') {
        // Ensure a reusable per-100g library row (branded/DSLD/manual), then log
        // grams against it. An existing library pick already has its id.
        let libraryId = selected.libraryId
        if (!libraryId) {
          const lib = await upsertExternalFood({
            name: selected.name, unit: 'g', ...selected.per100,
            serving_label: selected.serving_label, serving_grams: selected.serving_grams,
            food_group: 'Supplements', source: selected.source, source_ref: selected.source_ref, image_url: selected.image_url,
          })
          libraryId = lib.id
          qc.invalidateQueries({ queryKey: ['recipe-ingredient-library'] })
        }
        await addEntries.mutateAsync([{ ...base, library_ingredient_id: libraryId, quantity: amt, unit: 'g' }])
      } else {
        // Count-based (capsules/tablets with no gram serving) → a reusable diary
        // line; it reappears under Recent for one-tap re-logging.
        await addEntries.mutateAsync([{ ...base, custom_title: selected.name, quantity: amt, unit: selected.serving_label || 'serving' }])
      }
      toast.dismiss(tid); toast.success('Logged to supplements ✓')
      onClose()
    } catch (e) {
      toast.dismiss(tid); toast.error((e as Error).message ?? 'Failed')
    } finally { setSaving(false) }
  }

  const inputCls = 'min-h-[40px] px-2.5 text-sm border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'
  const servingsHint = selected?.kind === 'grams' && selected.serving_grams ? amt / selected.serving_grams : null

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[92vh] overflow-y-auto bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="px-5 pt-5 pb-3 border-b border-ink-100 flex items-center justify-between sticky top-0 bg-cream-50 z-10">
            <h2 className="text-base font-bold text-ink-900">💊 Supplements</h2>
            <button type="button" onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Recent supplements — fast re-log */}
            {recents.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">🕒 Recent</p>
                <div className="flex flex-wrap gap-1.5">
                  {recents.slice(0, 6).map(r => (
                    <button key={r.key} type="button" onClick={() => reLog(r)}
                      className="text-xs px-2.5 min-h-[36px] rounded-full border border-ink-200 bg-cream-100 text-ink-700 hover:border-accent-400 transition-colors press-feedback">
                      + {r.title}{r.protein_g != null && r.protein_g > 0 && <span className="text-ink-400 ml-1">{Math.round(r.protein_g)}p</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Source toggle + search + barcode */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="flex gap-1 bg-cream-100 p-0.5 rounded-lg">
                  {(['library', 'online'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setMode(m)}
                      className={`text-[11px] px-2.5 min-h-[32px] rounded-md font-medium transition-colors ${mode === m ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-400 hover:text-ink-600'}`}>
                      {m === 'library' ? 'My library' : '🔎 Online'}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setScanOpen(true)}
                  className="ml-auto shrink-0 min-w-[44px] min-h-[40px] px-2 rounded-lg border border-ink-200 bg-cream-100 text-ink-600 hover:border-accent-400 flex items-center justify-center text-lg"
                  title="Scan a barcode (Open Food Facts)" aria-label="Scan barcode">📷</button>
              </div>

              <div className="flex gap-1.5">
                <input value={query} onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && mode === 'online') runOnlineSearch() }}
                  placeholder={mode === 'online' ? 'Search DSLD (creatine, whey, pre-workout)…' : 'Search your supplements…'}
                  className={`flex-1 min-w-0 ${inputCls}`} />
                {mode === 'online' && (
                  <button type="button" onClick={runOnlineSearch} disabled={searching || !query.trim()}
                    className="shrink-0 min-h-[40px] px-3 rounded-lg text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
                    {searching ? '…' : 'Search'}
                  </button>
                )}
              </div>

              {/* Results */}
              {mode === 'library' ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {libMatches.map(item => (
                    <button key={item.id} type="button" onClick={() => selectLibrary(item)}
                      className="text-xs px-2.5 min-h-[36px] rounded-full border border-ink-200 bg-cream-100 text-ink-700 hover:border-accent-400 transition-colors">
                      + {item.name}{item.calories != null && <span className="text-ink-400 ml-1">{Math.round(item.calories)}kcal/100g</span>}
                    </button>
                  ))}
                  {library.length === 0 && <p className="text-xs text-ink-400 py-1">No saved supplements yet — search online or scan a barcode.</p>}
                </div>
              ) : (
                <div className="mt-1.5 flex flex-col gap-1">
                  {loadingLabel && <p className="text-xs text-ink-400">Loading label…</p>}
                  {onlineHits.map(hit => (
                    <button key={hit.id} type="button" onClick={() => selectOnlineHit(hit)}
                      className="text-left text-xs px-3 py-2 min-h-[40px] rounded-lg border border-ink-200 bg-cream-100 hover:border-accent-400 transition-colors">
                      <span className="font-medium text-ink-800">{hit.name}</span>
                      {hit.brand && <span className="text-ink-400"> · {hit.brand}</span>}
                      {hit.form && <span className="text-ink-300"> · {hit.form}</span>}
                    </button>
                  ))}
                  {!searching && !onlineHits.length && query.trim() && <p className="text-xs text-ink-400 py-1">No online results — try a broader name, or ✎ add it manually.</p>}
                  <p className="text-[10px] text-ink-300 pt-0.5">Online results are US labels (NIH DSLD). Norwegian/EU brands: use 📷 barcode.</p>
                </div>
              )}
            </div>

            {/* Manual entry */}
            <div>
              <button type="button" onClick={() => setShowManual(v => !v)} className="text-xs text-accent-600 hover:text-accent-700 min-h-[36px]">
                ✎ {showManual ? 'Hide manual entry' : 'Add manually'}
              </button>
              {showManual && <ManualSupplement onPick={(sel, amt0) => { setSelected(sel); setAmount(amt0) }} inputCls={inputCls} />}
            </div>

            {/* Selected → amount + log */}
            {selected && (
              <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  {selected.image_url && <img src={selected.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-ink-200 shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-900 leading-snug">{selected.name}</p>
                    {selected.serving_label && <p className="text-[11px] text-ink-400">Serving: {selected.serving_label}{selected.kind === 'grams' && selected.serving_grams ? ` (${selected.serving_grams}g)` : ''}</p>}
                  </div>
                </div>

                {/* Active ingredients (creatine/caffeine grams) — the DSLD edge */}
                {selected.actives && selected.actives.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.actives.map((a, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-cream-100 border border-ink-200 text-ink-600 tabular-nums">
                        {a.name} {a.amount}{a.unit ? ` ${a.unit}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-[11px] text-ink-500 shrink-0">{selected.kind === 'grams' ? 'Amount' : 'Servings'}</label>
                  <div className="flex items-center gap-1">
                    <input value={amount} onChange={e => setAmount(sanitizeDecimal(e.target.value))} inputMode="decimal"
                      className="w-20 min-h-[36px] px-2 text-sm text-right border border-ink-200 rounded-lg bg-cream-50 tabular-nums" />
                    <span className="text-[11px] text-ink-400">{selected.kind === 'grams' ? 'g' : '×'}</span>
                  </div>
                  {servingsHint != null && <span className="text-[11px] text-ink-400 tabular-nums">≈ {r1(servingsHint)}× serving</span>}
                  <span className="text-[11px] text-ink-500 tabular-nums ml-auto">
                    <strong className="text-ink-800">{Math.round(snapshot.calories ?? 0)}</strong> kcal · {Math.round(snapshot.protein_g ?? 0)}g P
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-3.5 border-t border-ink-100 flex items-center gap-3 sticky bottom-0 bg-cream-50">
            <p className="text-[11px] text-ink-400 flex-1">Logs to today's <strong className="text-ink-600">supplement</strong> slot.</p>
            <button type="button" onClick={handleLog} disabled={!selected || amt <= 0 || saving || addEntries.isPending}
              className="min-h-[44px] px-5 rounded-xl text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors">
              {saving ? 'Logging…' : 'Log supplement'}
            </button>
          </div>
        </DialogPanel>
      </div>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />
    </Dialog>
  )
}

// Manual per-serving entry — for supplements not in any DB. Grams optional: if
// given, it becomes a reusable per-100g library row; if left blank it logs as a
// count-based serving.
function ManualSupplement({ onPick, inputCls }: { onPick: (sel: Selected, amount: string) => void; inputCls: string }) {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [grams, setGrams] = useState('')
  const [kcal, setKcal] = useState(''); const [prot, setProt] = useState('')
  const [carb, setCarb] = useState(''); const [fat, setFat] = useState('')

  function num(s: string): number | null { return s.trim() === '' ? null : Number(sanitizeDecimal(s)) }

  function apply() {
    if (!name.trim()) { toast.error('Name is required'); return }
    const perServing: Macros = { calories: num(kcal), protein_g: num(prot), carbs_g: num(carb), fat_g: num(fat), fiber_g: null, sugar_g: null }
    const sg = num(grams)
    if (sg && sg > 0) {
      const per100 = (v: number | null) => (v == null ? null : r1((v / sg) * 100))
      onPick({ kind: 'grams', name: name.trim(), serving_label: label.trim() || '1 serving', serving_grams: sg, per100: { calories: per100(perServing.calories), protein_g: per100(perServing.protein_g), carbs_g: per100(perServing.carbs_g), fat_g: per100(perServing.fat_g), fiber_g: null, sugar_g: null } }, String(sg))
    } else {
      onPick({ kind: 'count', name: name.trim(), serving_label: label.trim() || 'serving', perServing }, '1')
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-ink-200 bg-cream-50 p-3 flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-ink-500">Manual supplement — macros PER SERVING</p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Creatine Monohydrate)" className={inputCls} />
      <div className="grid grid-cols-2 gap-1.5">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Serving label (1 scoop)" className={inputCls} />
        <input value={grams} onChange={e => setGrams(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Serving grams (opt.)" className={inputCls} />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <input value={kcal} onChange={e => setKcal(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="kcal" className={inputCls} />
        <input value={prot} onChange={e => setProt(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Prot" className={inputCls} />
        <input value={carb} onChange={e => setCarb(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Carb" className={inputCls} />
        <input value={fat} onChange={e => setFat(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="Fat" className={inputCls} />
      </div>
      <button type="button" onClick={apply} disabled={!name.trim()}
        className="self-start min-h-[36px] px-3 rounded-lg text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50">
        Use this
      </button>
    </div>
  )
}
