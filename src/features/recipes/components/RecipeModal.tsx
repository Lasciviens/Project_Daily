import { useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { toast } from '../../../app/store'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton, SegmentedControl } from '../../../shared/ui'
import { useCreateRecipe, useUpdateRecipe } from '../hooks/useRecipes'
import { useIngredientLibrary, useCreateIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { parseRecipeText, parseRecipeFromUrl, estimateRecipeMacros } from '../../ai/api/aiApi'
import { sumMacros } from '../api/recipesApi'
import { MacroWarningBadge } from './MacroWarningBadge'
import { checkMacroConsistency } from '../macroSanity'
import type { RecipeWithIngredients, IngredientDraft, MacroMode, IngredientLibraryItem } from '../types'

interface Props {
  /** Controlled callers pass it; the `recipe` entity modal omits it (always open). */
  open?: boolean
  onClose: () => void
  recipe?: RecipeWithIngredients   // present → edit mode
}

const EMPTY_ROW: IngredientDraft = { name: '', quantity: null, unit: null, note: null, library_ingredient_id: null }
const NEW_INGREDIENT = '__new__'

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return isNaN(n) ? null : n
}

// Live preview while editing, over an already-loaded library array (no DB
// round-trip) — uses the same summation as the authoritative save-time
// computation in recipesApi.computeMacrosFromIngredients.
function previewMacros(ingredients: IngredientDraft[], servings: number, library: IngredientLibraryItem[]) {
  const byId = new Map(library.map(l => [l.id, l]))
  const { contributed, skippedCount, totals } = sumMacros(ingredients, byId)
  const per = (v: number) => Math.round((v / Math.max(1, servings)) * 10) / 10
  return { contributed, skipped: skippedCount, ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, per(v)])) } as
    { contributed: boolean; skipped: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number }
}

export function RecipeModal({ open = true, onClose, recipe }: Props) {
  const editMode = !!recipe
  const create = useCreateRecipe()
  const update = useUpdateRecipe()
  const { data: library = [] } = useIngredientLibrary()
  const createLibraryItem = useCreateIngredientLibraryItem()

  const [title,        setTitle]        = useState('')
  const [servings,     setServings]     = useState('1')
  const [ingredients,  setIngredients]  = useState<IngredientDraft[]>([{ ...EMPTY_ROW }])
  const [instructions, setInstructions] = useState('')
  const [description,  setDescription]  = useState('')
  const [macroMode,    setMacroMode]    = useState<MacroMode>('manual')
  const [category,     setCategory]     = useState<'' | 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement'>('')
  const [calories,     setCalories]     = useState('')
  const [protein,      setProtein]      = useState('')
  const [carbs,        setCarbs]        = useState('')
  const [fat,          setFat]          = useState('')
  const [fiber,        setFiber]        = useState('')
  const [sugar,        setSugar]        = useState('')
  const [sourceUrl,    setSourceUrl]    = useState('')
  const [imageUrl,     setImageUrl]     = useState('')
  const [newIngredientRow, setNewIngredientRow] = useState<number | null>(null)
  const [pasteOpen,    setPasteOpen]    = useState(false)
  const [pasteMode,    setPasteMode]    = useState<'text' | 'url'>('text')
  const [pasteText,    setPasteText]    = useState('')
  const [urlInput,     setUrlInput]     = useState('')
  const [parsing,      setParsing]      = useState(false)
  const [estimating,   setEstimating]   = useState(false)

  // Prefill when the modal opens or the edited recipe changes. Adjusting state
  // during render on a prop change is React's recommended pattern over a
  // setState-in-effect (matches FoodLogModal/AssignMealModal).
  const [seed, setSeed] = useState<{ open: boolean; recipe: RecipeWithIngredients | undefined }>({ open, recipe })
  if (open !== seed.open || recipe !== seed.recipe) {
    setSeed({ open, recipe })
    if (open) {
      if (recipe) {
        setTitle(recipe.title)
        setServings(String(recipe.servings))
        setIngredients(recipe.ingredients.length
          ? recipe.ingredients.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, library_ingredient_id: i.library_ingredient_id }))
          : [{ ...EMPTY_ROW }])
        setInstructions(recipe.instructions ?? '')
        setDescription(recipe.description ?? '')
        setMacroMode(recipe.macro_mode)
        setCategory(recipe.category ?? '')
        setCalories(recipe.calories?.toString() ?? '')
        setProtein(recipe.protein_g?.toString() ?? '')
        setCarbs(recipe.carbs_g?.toString() ?? '')
        setFat(recipe.fat_g?.toString() ?? '')
        setFiber(recipe.fiber_g?.toString() ?? '')
        setSugar(recipe.sugar_g?.toString() ?? '')
        setSourceUrl(recipe.source_url ?? '')
        setImageUrl(recipe.image_url ?? '')
      } else {
        setTitle(''); setServings('1'); setIngredients([{ ...EMPTY_ROW }])
        setInstructions(''); setDescription(''); setMacroMode('manual')
        setCalories(''); setProtein(''); setCarbs(''); setFiber(''); setSugar(''); setFat(''); setSourceUrl(''); setImageUrl('')
      }
      setNewIngredientRow(null)
      setPasteOpen(false); setPasteMode('text'); setPasteText(''); setUrlInput('')
    }
  }

  function setRow(idx: number, patch: Partial<IngredientDraft>) {
    setIngredients(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function addRow()          { setIngredients(rows => [...rows, { ...EMPTY_ROW }]) }
  function removeRow(idx: number) { setIngredients(rows => rows.filter((_, i) => i !== idx)) }

  function handleLinkChange(idx: number, value: string) {
    if (value === NEW_INGREDIENT) { setNewIngredientRow(idx); return }
    const lib = library.find(l => l.id === value)
    setRow(idx, { library_ingredient_id: value || null, unit: lib?.unit ?? ingredients[idx].unit, name: ingredients[idx].name || lib?.name || '' })
  }

  const preview = macroMode === 'from_ingredients' ? previewMacros(ingredients, Math.max(1, Number(servings) || 1), library) : null

  function applyParsedRecipe(parsed: Awaited<ReturnType<typeof parseRecipeText>>) {
    setTitle(parsed.title)
    setServings(String(Math.max(1, parsed.servings || 1)))
    setInstructions(parsed.instructions ?? '')
    setIngredients(parsed.ingredients.length
      ? parsed.ingredients.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, library_ingredient_id: null }))
      : [{ ...EMPTY_ROW }])
    if (parsed.macro_estimate) {
      setMacroMode('manual')
      setCalories(parsed.macro_estimate.calories?.toString() ?? '')
      setProtein(parsed.macro_estimate.protein_g?.toString() ?? '')
      setCarbs(parsed.macro_estimate.carbs_g?.toString() ?? '')
      setFat(parsed.macro_estimate.fat_g?.toString() ?? '')
      setFiber('')   // AI estimate doesn't include fiber — reset, don't carry a stale value
      setSugar(parsed.macro_estimate.sugar_g?.toString() ?? '')
    }
  }

  async function handleParsePaste() {
    if (!pasteText.trim()) return
    setParsing(true)
    const tid = toast.loading('Parsing recipe with AI…')
    try {
      applyParsedRecipe(await parseRecipeText(pasteText))
      toast.dismiss(tid); toast.success('Parsed ✓ — review before saving')
      setPasteOpen(false); setPasteText('')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed to parse')
    } finally {
      setParsing(false)
    }
  }

  async function handleParseUrl() {
    if (!urlInput.trim()) return
    setParsing(true)
    const tid = toast.loading('Fetching and parsing recipe…')
    try {
      applyParsedRecipe(await parseRecipeFromUrl(urlInput.trim()))
      setSourceUrl(urlInput.trim())
      toast.dismiss(tid); toast.success('Parsed ✓ — review before saving')
      setPasteOpen(false); setUrlInput('')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed to fetch/parse URL')
    } finally {
      setParsing(false)
    }
  }

  async function handleEstimateMacros() {
    const named = ingredients.filter(i => i.name.trim())
    if (!named.length) { toast.error('Add at least one ingredient first'); return }
    setEstimating(true)
    const tid = toast.loading('Estimating macros with AI…')
    try {
      const est = await estimateRecipeMacros(named, Math.max(1, Number(servings) || 1))
      setCalories(est.calories?.toString() ?? '')
      setProtein(est.protein_g?.toString() ?? '')
      setCarbs(est.carbs_g?.toString() ?? '')
      setFat(est.fat_g?.toString() ?? '')
      setSugar(est.sugar_g?.toString() ?? '')
      toast.dismiss(tid); toast.success('Estimated ✓ — adjust if needed')
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed to estimate')
    } finally {
      setEstimating(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    const input = {
      title, description: description.trim() || null, servings: Math.max(1, Number(servings) || 1),
      instructions: instructions.trim() || null,
      macro_mode: macroMode,
      calories: numOrNull(calories), protein_g: numOrNull(protein), carbs_g: numOrNull(carbs),
      fat_g: numOrNull(fat), fiber_g: numOrNull(fiber), sugar_g: numOrNull(sugar),
      source_url: sourceUrl.trim() || null,
      image_url: imageUrl.trim() || null,
      category: category || null,
      ingredients: ingredients.filter(i => i.name.trim()),
    }
    try {
      if (editMode && recipe) await update.mutateAsync({ id: recipe.id, input })
      else                    await create.mutateAsync(input)
      onClose()
    } catch { return }   // the hook already toasted + logged
  }

  const saving = create.isPending || update.isPending
  const warn = (text: string, check: NonNullable<ReturnType<typeof checkMacroConsistency>>) => (
    <div data-tone="warn" className="tone-text mt-2 flex items-center gap-1.5 text-meta">
      <MacroWarningBadge result={check} />
      <span>{text}</span>
    </div>
  )

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={editMode ? 'Edit recipe' : 'New recipe'}
      size="lg"
      dismissible={!saving}
      headerActions={
        <Button variant="ghost" size="sm" icon={<Sparkles />} onClick={() => setPasteOpen(o => !o)} aria-pressed={pasteOpen}>
          Paste recipe
        </Button>
      }
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose} disabled={saving}>Cancel</Button>
          <Button block variant="primary" onClick={handleSave} loading={saving} disabled={!title.trim()}>
            {editMode ? 'Save changes' : 'Add recipe'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {pasteOpen && (
          <div className="flex flex-col gap-2 rounded-card border border-accent-500/25 bg-accent-50 p-3">
            <SegmentedControl<'text' | 'url'>
              size="sm" value={pasteMode} onChange={setPasteMode}
              options={[{ value: 'text', label: 'Paste text' }, { value: 'url', label: 'From URL' }]}
            />
            {pasteMode === 'text' ? (
              <>
                <p className="text-meta text-accent-700">Paste a recipe (from anywhere) — AI fills in the title, servings, ingredients, instructions and a rough macro estimate (translated to Turkish).</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5} placeholder="Paste recipe text here…"
                  aria-label="Recipe text" className="input resize-none" />
                <div className="flex gap-2">
                  <Button variant="ghost" block onClick={() => setPasteOpen(false)}>Cancel</Button>
                  <Button variant="primary" block onClick={handleParsePaste} loading={parsing} disabled={!pasteText.trim()}>Parse with AI</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-meta text-accent-700">Paste a recipe page link — AI fetches it, extracts the recipe and translates everything to Turkish.</p>
                <input value={urlInput} onChange={e => setUrlInput(e.target.value)} type="url" placeholder="https://…" aria-label="Recipe URL" className="input" />
                <div className="flex gap-2">
                  <Button variant="ghost" block onClick={() => setPasteOpen(false)}>Cancel</Button>
                  <Button variant="primary" block onClick={handleParseUrl} loading={parsing} disabled={!urlInput.trim()}>Fetch and parse</Button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Recipe title" aria-label="Recipe title" autoFocus className="input flex-1" />
          <select value={category} onChange={e => setCategory(e.target.value as typeof category)} aria-label="Category"
            className="select w-auto shrink-0 capitalize">
            <option value="">Category</option>
            {(['breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as const).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (optional)" rows={2}
          aria-label="Description" className="input resize-none" />

        <div>
          <label htmlFor="rm-servings" className="field-label">Base servings</label>
          <input id="rm-servings" type="number" min="1" value={servings} onChange={e => setServings(e.target.value)} className="input w-24 text-center tabular-nums" />
        </div>

        <section>
          <h3 className="field-label">Ingredients</h3>
          <div className="flex flex-col gap-1.5">
            {ingredients.map((row, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <input value={row.quantity ?? ''} onChange={e => setRow(i, { quantity: numOrNull(e.target.value) })} placeholder="Qty" aria-label="Quantity" inputMode="decimal"
                    className="input w-14 px-2 text-center tabular-nums" />
                  <input value={row.unit ?? ''} onChange={e => setRow(i, { unit: e.target.value })} placeholder="Unit" aria-label="Unit"
                    className="input w-16 px-2" />
                  <input value={row.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="Ingredient" aria-label="Ingredient"
                    className="input min-w-0 flex-1 px-2" />
                  <IconButton label="Remove ingredient" onClick={() => removeRow(i)} className="text-fg-faint hover:text-danger"><X /></IconButton>
                </div>
                {macroMode === 'from_ingredients' && (
                  <select
                    value={row.library_ingredient_id ?? ''}
                    onChange={e => handleLinkChange(i, e.target.value)}
                    aria-label="Library ingredient"
                    className="select ml-[3.75rem] w-auto text-meta"
                  >
                    <option value="">— link to a library ingredient for macros —</option>
                    {library.map(l => <option key={l.id} value={l.id}>{l.name} (per 100{l.unit})</option>)}
                    <option value={NEW_INGREDIENT}>+ New library ingredient…</option>
                  </select>
                )}
                {newIngredientRow === i && (
                  <NewIngredientInline
                    defaultName={row.name}
                    onCancel={() => setNewIngredientRow(null)}
                    onCreate={async draft => {
                      const created = await createLibraryItem.mutateAsync(draft)
                      setRow(i, { library_ingredient_id: created.id, unit: created.unit, name: row.name || created.name })
                      setNewIngredientRow(null)
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 text-accent-600" icon={<Plus />} onClick={addRow}>Add ingredient</Button>
        </section>

        <div>
          <label htmlFor="rm-instructions" className="field-label">Instructions</label>
          <textarea id="rm-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="One step per line…" rows={4}
            className="input resize-none" />
        </div>

        <section>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="field-label mb-0">Macros (per serving)</h3>
            <SegmentedControl<MacroMode>
              size="sm" value={macroMode} onChange={setMacroMode}
              options={[{ value: 'manual', label: 'Manual' }, { value: 'from_ingredients', label: 'From ingredients' }]}
            />
          </div>

          {macroMode === 'manual' ? (
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { v: calories, set: setCalories, label: 'Calories (kcal)' },
                  { v: protein,  set: setProtein,  label: 'Protein (g)' },
                  { v: carbs,    set: setCarbs,    label: 'Carbs (g)' },
                  { v: fat,      set: setFat,      label: 'Fat (g)' },
                  { v: fiber,    set: setFiber,    label: 'Fiber (g)' },
                  { v: sugar,    set: setSugar,    label: 'Sugar (g)' },
                ].map(m => (
                  <label key={m.label} className="block">
                    <span className="mb-0.5 block text-meta text-fg-muted">{m.label}</span>
                    <input value={m.v} onChange={e => m.set(e.target.value)} inputMode="decimal" className="input px-2 text-center tabular-nums" />
                  </label>
                ))}
              </div>
              {(() => {
                const num = (v: string) => (v.trim() === '' ? null : Number(v))
                const check = checkMacroConsistency(num(calories), num(protein), num(carbs), num(fat))
                return check?.inconsistent ? warn(`Calories don't match protein/carbs/fat — ${check.deltaPct}% off. Tap the badge for details.`, check) : null
              })()}
              <Button variant="ghost" size="sm" className="mt-2 text-accent-600" icon={<Sparkles />} onClick={handleEstimateMacros} loading={estimating}>
                Estimate with AI
              </Button>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: 'Calories (kcal)', v: preview?.calories },
                  { label: 'Protein (g)',     v: preview?.protein_g },
                  { label: 'Carbs (g)',       v: preview?.carbs_g },
                  { label: 'Fat (g)',         v: preview?.fat_g },
                  { label: 'Fiber (g)',       v: preview?.fiber_g },
                  { label: 'Sugar (g)',       v: preview?.sugar_g },
                ].map(m => (
                  <div key={m.label} className="rounded-row bg-surface-2 py-2 text-center">
                    <div className="text-ui font-bold text-fg tabular-nums">{preview?.contributed ? m.v : '—'}</div>
                    <div className="text-micro text-fg-muted">{m.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-meta text-fg-muted">
                {preview?.contributed
                  ? preview.skipped > 0 ? `Computed from linked ingredients — ${preview.skipped} skipped (link them and use g/ml to include).` : 'Computed live from linked ingredients.'
                  : 'Link ingredients above to a library entry (with a g/ml quantity) to compute macros automatically.'}
              </p>
              {(() => {
                if (!preview?.contributed) return null
                const check = checkMacroConsistency(preview.calories, preview.protein_g, preview.carbs_g, preview.fat_g)
                return check?.inconsistent ? warn(`These totals don't add up cleanly — ${check.deltaPct}% off. Likely one linked ingredient has bad source data.`, check) : null
              })()}
            </div>
          )}
        </section>

        <div>
          <label htmlFor="rm-image" className="field-label">Image URL (optional)</label>
          <div className="flex items-center gap-2">
            {imageUrl.trim() && (
              <img src={imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-line object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
            )}
            <input id="rm-image" value={imageUrl} onChange={e => setImageUrl(e.target.value)} type="url" placeholder="https://…" className="input" />
          </div>
        </div>

        <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Source link (optional)" aria-label="Source link" className="input" />
      </div>
    </ModalShell>
  )
}

// Inline "create a new library ingredient" form — appears under an ingredient
// row when the user picks "+ New library ingredient…" from the link select.
function NewIngredientInline({ defaultName, onCancel, onCreate }: {
  defaultName: string
  onCancel: () => void
  onCreate: (draft: { name: string; unit: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; sugar_g: number | null }) => Promise<void>
}) {
  const [name,     setName]     = useState(defaultName)
  const [unit,     setUnit]     = useState('g')
  const [calories, setCalories] = useState('')
  const [protein,  setProtein]  = useState('')
  const [carbs,    setCarbs]    = useState('')
  const [fat,      setFat]      = useState('')
  const [sugar,    setSugar]    = useState('')
  const [saving,   setSaving]   = useState(false)

  async function handleCreate() {
    if (!name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      await onCreate({
        name: name.trim(), unit: unit.trim() || 'g',
        calories: numOrNull(calories), protein_g: numOrNull(protein),
        carbs_g: numOrNull(carbs), fat_g: numOrNull(fat), sugar_g: numOrNull(sugar),
      })
    } catch {
      // The create hook (useMutationWithFeedback) already toasted + logged.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ml-[3.75rem] flex flex-col gap-1.5 rounded-row border border-accent-500/25 bg-accent-50 p-2.5">
      <p className="text-meta font-semibold text-accent-700">New library ingredient — macros per 100{unit || 'g'}</p>
      <div className="flex gap-1.5">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" className="input flex-1 px-2" />
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit" aria-label="Unit" className="input w-14 px-2 text-center" />
      </div>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
        {[
          { v: calories, set: setCalories, ph: 'kcal' },
          { v: protein,  set: setProtein,  ph: 'Protein' },
          { v: carbs,    set: setCarbs,    ph: 'Carbs' },
          { v: fat,      set: setFat,      ph: 'Fat' },
          { v: sugar,    set: setSugar,    ph: 'Sugar' },
        ].map(m => (
          <input key={m.ph} value={m.v} onChange={e => m.set(e.target.value)} placeholder={m.ph} aria-label={m.ph} inputMode="decimal"
            className="input px-1 text-center tabular-nums" />
        ))}
      </div>
      {(() => {
        const num = (v: string) => (v.trim() === '' ? null : Number(v))
        const check = checkMacroConsistency(num(calories), num(protein), num(carbs), num(fat))
        return check?.inconsistent ? (
          <div data-tone="warn" className="tone-text flex items-center gap-1.5 text-meta">
            <MacroWarningBadge result={check} />
            <span>Calories don't match protein/carbs/fat — {check.deltaPct}% off.</span>
          </div>
        ) : null
      })()}
      <div className="mt-0.5 flex gap-1.5">
        <Button variant="ghost" size="sm" block onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" block onClick={handleCreate} loading={saving}>Create</Button>
      </div>
    </div>
  )
}
