import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Pencil, Plus, ScanBarcode, Search, X } from 'lucide-react'
import { useIngredientLibrary, useCreateIngredientLibraryItem, useUpdateIngredientLibraryItem, useDeleteIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { toast } from '../../../app/store'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { lookupBarcode, type BarcodeProduct } from '../api/openFoodFactsApi'
import { BarcodeScanner } from './BarcodeScanner'
import { OnlineFoodSearch } from './OnlineFoodSearch'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Button, Card, EmptyState, IconButton, SkeletonText, cx } from '../../../shared/ui'
import { MacroWarningBadge } from './MacroWarningBadge'
import { checkMacroConsistency } from '../macroSanity'
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
  const [scanOpen, setScanOpen] = useState(false)
  const [onlineOpen, setOnlineOpen] = useState(false)
  const [meta, setMeta] = useState<{ source: string; source_ref: string; image_url: string | null } | null>(null)
  // Mobile-only disclosure: expanded, the 11-field form eats ~400px and pushes
  // "Your foods" — the list you came for — off the bottom of a 852px screen.
  // Always expanded from sm: (see the `sm:flex` on the fields wrapper below).
  const [formOpen, setFormOpen] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const set = (k: keyof typeof EMPTY, v: string) => setF(prev => ({ ...prev, [k]: v }))

  // Prefill the add-form from a scanned/searched product (per-100g, editable).
  function prefillFromProduct(p: BarcodeProduct) {
    const s = (n: number | null) => (n == null ? '' : String(n))
    setEditingId(null)
    setF({
      name: p.name, unit: 'g',
      kcal: s(p.calories), prot: s(p.protein_g), carb: s(p.carbs_g), fat: s(p.fat_g), fiber: s(p.fiber_g), sugar: s(p.sugar_g),
      servLabel: p.serving_grams != null ? '1 serving' : '', servGrams: s(p.serving_grams), group: '',
    })
    setMeta({ source: p.source ?? 'openfoodfacts', source_ref: p.code, image_url: p.image_url })
    setOnlineOpen(false)
    setFormOpen(true)   // a prefilled form must be visible to be reviewed
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleBarcode(code: string) {
    setScanOpen(false)
    const tid = toast.loading('Looking up barcode…')
    try {
      const p = await lookupBarcode(code)
      toast.dismiss(tid)
      if (!p) { toast.error('Product not found'); return }
      prefillFromProduct(p); toast.success(`Found: ${p.name}`)
    } catch { toast.dismiss(tid); toast.error('Barcode lookup failed') }
  }

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

  function reset() { setF({ ...EMPTY }); setEditingId(null); setMeta(null); setOnlineOpen(false) }

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
    setFormOpen(true)   // ✎ must open the collapsed mobile form, not just scroll to it
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
      ...(meta && !editingId ? { source: meta.source, source_ref: meta.source_ref, image_url: meta.image_url } : {}),
    }
    const ok = await withProgress(async () => {
      if (editingId) await update.mutateAsync({ id: editingId, input })
      else await create.mutateAsync(input)
      return true
    }, { loading: editingId ? 'Saving…' : 'Adding…', success: editingId ? 'Saved' : 'Added' })
    if (ok) reset()
  }

  async function handleDelete(ing: IngredientLibraryItem) {
    const confirmed = await entityModal.confirm({ title: `Delete "${ing.name}"?`, message: 'This removes it from your food library.', confirmLabel: 'Delete', destructive: true })
    if (!confirmed) return
    void withProgress(() => remove.mutateAsync(ing.id), { loading: 'Deleting…', success: 'Deleted' })
  }

  const busy = create.isPending || update.isPending
  const formTitle = editingId ? 'Edit ingredient' : 'New ingredient'
  const consistency = checkMacroConsistency(
    f.kcal === '' ? null : Number(f.kcal), f.prot === '' ? null : Number(f.prot),
    f.carb === '' ? null : Number(f.carb), f.fat === '' ? null : Number(f.fat),
  )
  const macroField = (k: 'kcal' | 'prot' | 'carb' | 'fat' | 'fiber' | 'sugar', label: string) => (
    <input value={f[k]} onChange={e => set(k, sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder={label} aria-label={label} className="input" />
  )

  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,46rem)]">
      {/* Add / edit form — sticky beside the list on wide screens */}
      <div ref={formRef} className="scroll-mt-4 xl:sticky xl:top-4">
      <Card className={cx('flex flex-col gap-3', editingId && '!border-accent-500/50')}>
        <div className="-my-1 flex items-center gap-2">
          {/* On phones the title is the disclosure toggle; scan and search stay
              visible either way and open the form once a product is picked. */}
          <button type="button" onClick={() => setFormOpen(o => !o)} aria-expanded={formOpen}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left sm:hidden">
            <span className="section-label truncate">{formTitle}</span>
            <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', formOpen && 'rotate-180')} />
          </button>
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="section-label">{formTitle}</p>
            <p className="text-meta text-fg-muted">Macros per 100g</p>
          </div>
          {!editingId ? (
            <>
              <IconButton label="Scan a barcode" bordered onClick={() => setScanOpen(true)}><ScanBarcode /></IconButton>
              <IconButton label="Search online" bordered aria-pressed={onlineOpen} onClick={() => setOnlineOpen(o => !o)}
                className={onlineOpen ? '!border-accent-500 !bg-accent-50 !text-accent-600' : undefined}><Search /></IconButton>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>
          )}
        </div>
        {onlineOpen && !editingId && (
          <div className="rounded-row border border-line bg-surface-2 p-2.5">
            <OnlineFoodSearch initialQuery={f.name} onPick={prefillFromProduct} />
          </div>
        )}
        <div className={cx(formOpen ? 'flex' : 'hidden', 'flex-col gap-2 sm:flex')}>
          <input value={f.name} onChange={e => set('name', e.target.value)} placeholder="Name (e.g. chicken breast)" aria-label="Name" className="input" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
            {macroField('kcal', 'Calories')}
            {macroField('prot', 'Protein g')}
            {macroField('carb', 'Carbs g')}
            {macroField('fat', 'Fat g')}
            {macroField('fiber', 'Fiber g')}
            {macroField('sugar', 'Sugar g')}
          </div>
          {consistency?.inconsistent && (
            <div className="flex items-center gap-2 text-meta text-warn">
              <MacroWarningBadge result={consistency} />
              <span>Calories don't match protein, carbs and fat — {consistency.deltaPct}% off. Tap the badge for details.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
            <input value={f.servLabel} onChange={e => set('servLabel', e.target.value)} placeholder="Portion (1 scoop)" aria-label="Portion name" className="input" />
            <input value={f.servGrams} onChange={e => set('servGrams', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams (30)" aria-label="Portion grams" className="input" />
            <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="Unit (g)" aria-label="Unit" className="input" />
            <select value={f.group} onChange={e => set('group', e.target.value)} aria-label="Category" className="select">
              <option value="">Category…</option>
              {FOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <Button variant="primary" icon={editingId ? undefined : <Plus />} onClick={handleSave} loading={busy} disabled={!f.name.trim()} className="self-start">
            {editingId ? 'Save changes' : 'Add ingredient'}
          </Button>
        </div>
      </Card>
      </div>

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />

      <div className="flex min-w-0 flex-col gap-3">
        {(presentGroups.ordered.length > 0 || presentGroups.hasOther) && (
          <div role="tablist" aria-label="Food group" className="scroll-x -mx-1 flex gap-1.5 px-1">
            <button type="button" role="tab" aria-selected={catFilter === null} className="pill-tab shrink-0" onClick={() => setCatFilter(null)}>All</button>
            {presentGroups.ordered.map(g => (
              <button key={g} type="button" role="tab" aria-selected={catFilter === g} className="pill-tab shrink-0" onClick={() => setCatFilter(g)}>{g}</button>
            ))}
            {presentGroups.hasOther && <button type="button" role="tab" aria-selected={catFilter === '__other'} className="pill-tab shrink-0" onClick={() => setCatFilter('__other')}>Other</button>}
          </div>
        )}

        <Card padded={false} className="overflow-hidden">
          <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <p className="section-label flex-1">Your foods <span className="count-badge ml-1 normal-case tracking-normal">{filtered.length}{catFilter || q ? ` / ${library.length}` : ''}</span></p>
            <label className="relative w-36 sm:w-48">
              <span className="sr-only">Search your foods</span>
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="input pl-8" />
            </label>
          </header>
          {isLoading ? (
            <div className="p-4"><SkeletonText lines={5} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState title={q || catFilter ? 'No match' : 'No foods yet'}
              description={q || catFilter ? undefined : 'Add your basics (chicken, rice, oats, whey…) with the form.'} />
          ) : (
            <ul className="divide-y divide-line">
              {filtered.slice(0, 300).map(ing => {
                const macroCheck = checkMacroConsistency(ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g)
                const num = 'hidden w-12 shrink-0 text-right text-meta tabular-nums text-fg-muted sm:block'
                return (
                  <li key={ing.id} className="flex min-h-[48px] items-center gap-2 py-1 pl-4 pr-2 text-body">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{ing.name}</span>
                      {(ing.food_group || ing.serving_label) && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          {ing.food_group && <span className="chip">{ing.food_group}</span>}
                          {ing.serving_label && ing.serving_grams != null && (
                            <span className="chip tabular-nums">{ing.serving_label} {Math.round(ing.serving_grams)}g</span>
                          )}
                        </span>
                      )}
                    </div>
                    <MacroWarningBadge result={macroCheck} />
                    <span className="w-16 shrink-0 text-right text-meta font-medium tabular-nums text-fg-2">{ing.calories ?? '—'} kcal</span>
                    <span className="w-12 shrink-0 text-right text-meta tabular-nums text-fg-muted">{ing.protein_g ?? '—'}g P</span>
                    <span className={num}>{ing.carbs_g ?? '—'}g C</span>
                    <span className={num}>{ing.fat_g ?? '—'}g F</span>
                    <IconButton label={`Edit ${ing.name}`} onClick={() => startEdit(ing)}><Pencil /></IconButton>
                    <IconButton label={`Delete ${ing.name}`} onClick={() => handleDelete(ing)} className="text-fg-faint hover:!text-danger"><X /></IconButton>
                  </li>
                )
              })}
            </ul>
          )}
          {filtered.length > 300 && <p className="border-t border-line px-4 py-2 text-meta text-fg-muted">Showing the first 300 — search or filter to narrow.</p>}
        </Card>
        <p className="max-w-2xl text-meta text-fg-muted">Per-100g is the source of truth; portion presets are one-tap conveniences. Logged meals snapshot their macros — editing a food later never rewrites your history. Nutrition data: Matvaretabellen (Mattilsynet), NLOD.</p>
      </div>
    </div>
  )
}
