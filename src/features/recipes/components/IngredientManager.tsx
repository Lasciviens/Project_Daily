import { useRef, useState } from 'react'
import { ChevronDown, Plus, ScanBarcode, Search } from 'lucide-react'
import { useIngredientLibrary, useCreateIngredientLibraryItem, useUpdateIngredientLibraryItem, useDeleteIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { toast } from '../../../app/store'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { lookupBarcode, type BarcodeProduct } from '../api/openFoodFactsApi'
import { BarcodeScanner } from './BarcodeScanner'
import { OnlineFoodSearch } from './OnlineFoodSearch'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Button, Card, IconButton, PageBoard, Truncate, cx } from '../../../shared/ui'
import { IngredientList } from './IngredientList'
import { sanitizeDecimal } from './foodLogUtils'
import { INGREDIENT_BOARD } from '../foodBoards'
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

const EMPTY = { name: '', unit: 'g', kcal: '', prot: '', carb: '', fat: '', fiber: '', sugar: '', servLabel: '', servGrams: '', group: '' }

export function IngredientManager() {
  const { data: library = [], isLoading } = useIngredientLibrary()
  const create = useCreateIngredientLibraryItem()
  const update = useUpdateIngredientLibraryItem()
  const remove = useDeleteIngredientLibraryItem()

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

  async function handleDelete(ing: IngredientLibraryItem, usedIn: number) {
    const message = usedIn > 0
      ? `It is in ${usedIn} recipe${usedIn === 1 ? '' : 's'}. ${usedIn === 1 ? 'That recipe keeps' : 'They keep'} the totals ${usedIn === 1 ? 'it has' : 'they have'} now (switched to typed macros), and days you ate it keep theirs.`
      : 'Days you ate it keep their totals.'
    const confirmed = await entityModal.confirm({ title: `Delete "${ing.name}"?`, message, confirmLabel: 'Delete', destructive: true })
    if (!confirmed) return
    if (editingId === ing.id) reset()
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
    <>
    {/* Placed by PageBoard (foodBoards.ts): the add / edit form is a sticky
        rail beside the list on wide screens. */}
    <PageBoard layout={INGREDIENT_BOARD} stackGap="gap-3 sm:gap-4" sections={{
      form: (
      <div ref={formRef} className="scroll-mt-4">
      <Card className={cx('@container flex flex-col gap-3', editingId && '!border-accent-500/50')}>
        <div className="-my-1 flex items-center gap-2">
          {/* On phones the title is the disclosure toggle; scan and search stay
              visible either way and open the form once a product is picked. */}
          <button type="button" onClick={() => setFormOpen(o => !o)} aria-expanded={formOpen}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left sm:hidden">
            <Truncate className="section-label">{formTitle}</Truncate>
            <ChevronDown aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', formOpen && 'rotate-180')} />
          </button>
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="section-label">{formTitle}</p>
            <p className="text-meta text-fg-muted">Macros per 100 {f.unit === 'ml' ? 'ml' : 'g'}</p>
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
          <div className="grid grid-cols-2 gap-2 @[30rem]:grid-cols-3">
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
          <div className="grid grid-cols-2 gap-2 @[36rem]:grid-cols-4">
            <input value={f.servLabel} onChange={e => set('servLabel', e.target.value)} placeholder="Portion (1 scoop)" aria-label="Portion name" className="input" />
            <input value={f.servGrams} onChange={e => set('servGrams', sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams (30)" aria-label="Portion grams" className="input" />
            {/* Macros are per 100 g or 100 ml: any other unit ("stk") could never be counted. */}
            <select value={f.unit} onChange={e => set('unit', e.target.value)} aria-label="Macros per" className="select">
              <option value="g">per 100 g</option>
              <option value="ml">per 100 ml</option>
              {f.unit !== 'g' && f.unit !== 'ml' && <option value={f.unit}>{f.unit} (old)</option>}
            </select>
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
      </div>),

      list: <IngredientList library={library} isLoading={isLoading} editingId={editingId} onEdit={startEdit} onDelete={handleDelete} />,
    }} />

    <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleBarcode} />
    </>
  )
}
