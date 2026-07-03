import { useState, useEffect } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { toast } from '../../../app/store'
import { useCreateRecipe, useUpdateRecipe } from '../hooks/useRecipes'
import { useIngredientLibrary, useCreateIngredientLibraryItem } from '../hooks/useIngredientLibrary'
import { parseRecipeText, parseRecipeFromUrl, estimateRecipeMacros } from '../../ai/api/aiApi'
import type { RecipeWithIngredients, IngredientDraft, MacroMode, IngredientLibraryItem } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  recipe?: RecipeWithIngredients   // present → edit mode
}

const EMPTY_ROW: IngredientDraft = { name: '', quantity: null, unit: null, note: null, library_ingredient_id: null }
const NEW_INGREDIENT = '__new__'
const WEIGHT_UNITS = new Set(['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters'])

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return isNaN(n) ? null : n
}

// Mirrors recipesApi.computeMacrosFromIngredients but synchronous over an
// already-loaded library array — used for the live preview while editing.
// The authoritative save-time computation still happens server-side.
function previewMacros(ingredients: IngredientDraft[], servings: number, library: IngredientLibraryItem[]) {
  const byId = new Map(library.map(l => [l.id, l]))
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0 }
  let contributed = false
  let skipped = 0
  for (const ing of ingredients) {
    if (!ing.library_ingredient_id) continue
    const lib = byId.get(ing.library_ingredient_id)
    const unitOk = ing.unit && WEIGHT_UNITS.has(ing.unit.trim().toLowerCase())
    if (!lib || !unitOk || ing.quantity == null) { skipped++; continue }
    const factor = ing.quantity / 100
    totals.calories  += (lib.calories  ?? 0) * factor
    totals.protein_g += (lib.protein_g ?? 0) * factor
    totals.carbs_g   += (lib.carbs_g   ?? 0) * factor
    totals.fat_g     += (lib.fat_g     ?? 0) * factor
    totals.sugar_g   += (lib.sugar_g   ?? 0) * factor
    contributed = true
  }
  const per = (v: number) => Math.round((v / Math.max(1, servings)) * 10) / 10
  return { contributed, skipped, ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, per(v)])) } as
    { contributed: boolean; skipped: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; sugar_g: number }
}

export function RecipeModal({ open, onClose, recipe }: Props) {
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
  const [calories,     setCalories]     = useState('')
  const [protein,      setProtein]      = useState('')
  const [carbs,        setCarbs]        = useState('')
  const [fat,          setFat]          = useState('')
  const [sugar,        setSugar]        = useState('')
  const [sourceUrl,    setSourceUrl]    = useState('')
  const [imageUrl,     setImageUrl]     = useState('')
  const [saving,       setSaving]       = useState(false)
  const [newIngredientRow, setNewIngredientRow] = useState<number | null>(null)
  const [pasteOpen,    setPasteOpen]    = useState(false)
  const [pasteMode,    setPasteMode]    = useState<'text' | 'url'>('text')
  const [pasteText,    setPasteText]    = useState('')
  const [urlInput,     setUrlInput]     = useState('')
  const [parsing,      setParsing]      = useState(false)
  const [estimating,   setEstimating]   = useState(false)

  useEffect(() => {
    if (!open) return
    if (recipe) {
      setTitle(recipe.title)
      setServings(String(recipe.servings))
      setIngredients(recipe.ingredients.length
        ? recipe.ingredients.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, library_ingredient_id: i.library_ingredient_id }))
        : [{ ...EMPTY_ROW }])
      setInstructions(recipe.instructions ?? '')
      setDescription(recipe.description ?? '')
      setMacroMode(recipe.macro_mode)
      setCalories(recipe.calories?.toString() ?? '')
      setProtein(recipe.protein_g?.toString() ?? '')
      setCarbs(recipe.carbs_g?.toString() ?? '')
      setFat(recipe.fat_g?.toString() ?? '')
      setSugar(recipe.sugar_g?.toString() ?? '')
      setSourceUrl(recipe.source_url ?? '')
      setImageUrl(recipe.image_url ?? '')
    } else {
      setTitle(''); setServings('1'); setIngredients([{ ...EMPTY_ROW }])
      setInstructions(''); setDescription(''); setMacroMode('manual')
      setCalories(''); setProtein(''); setCarbs(''); setSugar(''); setFat(''); setSourceUrl(''); setImageUrl('')
    }
    setNewIngredientRow(null)
    setPasteOpen(false); setPasteMode('text'); setPasteText(''); setUrlInput('')
  }, [open, recipe])

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
      fat_g: numOrNull(fat), sugar_g: numOrNull(sugar),
      source_url: sourceUrl.trim() || null,
      image_url: imageUrl.trim() || null,
      ingredients: ingredients.filter(i => i.name.trim()),
    }
    setSaving(true)
    const tid = toast.loading('Saving…')
    try {
      if (editMode && recipe) await update.mutateAsync({ id: recipe.id, input })
      else                    await create.mutateAsync(input)
      toast.dismiss(tid); toast.success('Saved ✓')
      onClose()
    } catch (err) {
      toast.dismiss(tid); toast.error((err as Error).message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-ink-100 sticky top-0 bg-white z-10">
            <h2 className="text-base font-bold text-ink-900">{editMode ? 'Edit recipe' : 'New recipe'}</h2>
            <button onClick={onClose} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl">×</button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Recipe title" autoFocus className={inputCls + ' mr-2'} />
              <button type="button" onClick={() => setPasteOpen(o => !o)}
                className="flex-shrink-0 text-xs text-accent-600 hover:text-accent-700 min-h-[44px] px-2 whitespace-nowrap">
                ✨ Paste recipe
              </button>
            </div>

            {pasteOpen && (
              <div className="p-3 rounded-xl border border-accent-200 bg-accent-50/50 flex flex-col gap-2">
                <div className="flex gap-1 bg-white p-0.5 rounded-lg w-fit">
                  {(['text', 'url'] as const).map(m => (
                    <button key={m} type="button" onClick={() => setPasteMode(m)}
                      className={`text-[10px] px-2.5 min-h-[28px] rounded-md font-medium transition-colors ${
                        pasteMode === m ? 'bg-accent-500 text-white' : 'text-ink-400 hover:text-ink-600'
                      }`}>
                      {m === 'text' ? 'Paste text' : 'From URL'}
                    </button>
                  ))}
                </div>

                {pasteMode === 'text' ? (
                  <>
                    <p className="text-[11px] text-accent-700">Paste a recipe (from anywhere) — AI will fill in the title, servings, ingredients, instructions, and a rough macro estimate (translated to Turkish).</p>
                    <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5} placeholder="Paste recipe text here…"
                      className="w-full bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-400" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setPasteOpen(false)} className="flex-1 min-h-[36px] text-xs text-ink-500 hover:bg-ink-100 rounded-lg">Cancel</button>
                      <button type="button" onClick={handleParsePaste} disabled={parsing || !pasteText.trim()}
                        className="flex-1 min-h-[36px] text-xs bg-accent-500 text-white rounded-lg hover:bg-accent-600 disabled:opacity-50">
                        {parsing ? 'Parsing…' : 'Parse with AI'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-accent-700">Paste a recipe page link — AI will fetch it, extract the recipe, and translate everything to Turkish.</p>
                    <input value={urlInput} onChange={e => setUrlInput(e.target.value)} type="url" placeholder="https://…"
                      className="w-full min-h-[40px] bg-white border border-ink-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setPasteOpen(false)} className="flex-1 min-h-[36px] text-xs text-ink-500 hover:bg-ink-100 rounded-lg">Cancel</button>
                      <button type="button" onClick={handleParseUrl} disabled={parsing || !urlInput.trim()}
                        className="flex-1 min-h-[36px] text-xs bg-accent-500 text-white rounded-lg hover:bg-accent-600 disabled:opacity-50">
                        {parsing ? 'Fetching…' : 'Fetch & Parse'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (optional)" rows={2}
              className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-400" />

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Base servings</label>
              <input type="number" min="1" value={servings} onChange={e => setServings(e.target.value)} className="w-24 min-h-[44px] bg-cream-50 border border-ink-200 rounded-xl px-3 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent-400" />
            </div>

            {/* Ingredients */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Ingredients</label>
              <div className="flex flex-col gap-1.5">
                {ingredients.map((row, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <input value={row.quantity ?? ''} onChange={e => setRow(i, { quantity: numOrNull(e.target.value) })} placeholder="Qty" inputMode="decimal"
                        className="w-14 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent-400" />
                      <input value={row.unit ?? ''} onChange={e => setRow(i, { unit: e.target.value })} placeholder="Unit"
                        className="w-16 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400" />
                      <input value={row.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="Ingredient"
                        className="flex-1 min-w-0 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400" />
                      <button onClick={() => removeRow(i)} className="min-w-[36px] min-h-[36px] flex items-center justify-center text-ink-300 hover:text-red-400 text-sm flex-shrink-0">×</button>
                    </div>
                    {macroMode === 'from_ingredients' && (
                      <select
                        value={row.library_ingredient_id ?? ''}
                        onChange={e => handleLinkChange(i, e.target.value)}
                        className="ml-[3.75rem] min-h-[36px] bg-white border border-ink-200 rounded-lg px-2 text-xs text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-400"
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
              <button onClick={addRow} className="mt-2 text-xs text-accent-600 hover:text-accent-700 min-h-[36px]">+ Add ingredient</button>
            </div>

            {/* Instructions */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Instructions</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="One step per line…" rows={4}
                className="w-full bg-cream-50 border border-ink-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-400" />
            </div>

            {/* Macros per serving */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Macros (per serving)</label>
                <div className="flex gap-1 bg-cream-100 p-0.5 rounded-lg">
                  {(['manual', 'from_ingredients'] as MacroMode[]).map(m => (
                    <button key={m} type="button" onClick={() => setMacroMode(m)}
                      className={`text-[10px] px-2 min-h-[28px] rounded-md font-medium transition-colors ${
                        macroMode === m ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-400 hover:text-ink-600'
                      }`}>
                      {m === 'manual' ? 'Manual' : 'From ingredients'}
                    </button>
                  ))}
                </div>
              </div>

              {macroMode === 'manual' ? (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { v: calories, set: setCalories, label: 'Calories (kcal)' },
                      { v: protein,  set: setProtein,  label: 'Protein (g)' },
                      { v: carbs,    set: setCarbs,    label: 'Carbs (g)' },
                      { v: fat,      set: setFat,      label: 'Fat (g)' },
                      { v: sugar,    set: setSugar,    label: 'Sugar (g)' },
                    ].map(m => (
                      <div key={m.label}>
                        <label className="text-[10px] text-ink-400 block mb-0.5">{m.label}</label>
                        <input value={m.v} onChange={e => m.set(e.target.value)} inputMode="decimal"
                          className="w-full min-h-[40px] bg-cream-50 border border-ink-200 rounded-lg px-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent-400" />
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={handleEstimateMacros} disabled={estimating}
                    className="mt-2 text-xs text-accent-600 hover:text-accent-700 min-h-[36px] disabled:opacity-50">
                    {estimating ? 'Estimating…' : '✨ Estimate with AI'}
                  </button>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { label: 'Calories (kcal)', v: preview?.calories },
                      { label: 'Protein (g)',     v: preview?.protein_g },
                      { label: 'Carbs (g)',       v: preview?.carbs_g },
                      { label: 'Fat (g)',         v: preview?.fat_g },
                      { label: 'Sugar (g)',       v: preview?.sugar_g },
                    ].map(m => (
                      <div key={m.label} className="text-center bg-ink-50 rounded-lg py-2">
                        <div className="text-sm font-bold text-ink-900">{preview?.contributed ? m.v : '—'}</div>
                        <div className="text-[9px] text-ink-400">{m.label}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-ink-400 mt-1.5">
                    {preview?.contributed
                      ? preview.skipped > 0 ? `Computed from linked ingredients — ${preview.skipped} skipped (link them + use g/ml to include).` : 'Computed live from linked ingredients.'
                      : 'Link ingredients above to a library entry (with a g/ml quantity) to compute macros automatically.'}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 block">Image URL (optional)</label>
              <div className="flex items-center gap-2">
                {imageUrl.trim() && (
                  <img src={imageUrl} alt="" className="w-11 h-11 rounded-lg object-cover border border-ink-200 flex-shrink-0" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                )}
                <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} type="url" placeholder="https://…" className={inputCls} />
              </div>
            </div>

            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="Source link (optional)" className={inputCls} />
          </div>

          <div className="px-5 py-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
            <button onClick={onClose} className="flex-1 min-h-[44px] border border-ink-200 text-ink-700 rounded-xl text-sm font-medium hover:bg-cream-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !title.trim()} className="flex-1 min-h-[44px] bg-accent-500 text-white rounded-xl text-sm font-semibold hover:bg-accent-600 disabled:opacity-50">
              {saving ? 'Saving…' : editMode ? 'Save changes' : 'Add recipe'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
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
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ml-[3.75rem] p-2.5 rounded-lg border border-accent-200 bg-accent-50/50 flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold text-accent-700">New library ingredient — macros per 100{unit || 'g'}</p>
      <div className="flex gap-1.5">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="flex-1 min-h-[36px] bg-white border border-ink-200 rounded-lg px-2 text-xs" />
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit" className="w-14 min-h-[36px] bg-white border border-ink-200 rounded-lg px-2 text-xs text-center" />
      </div>
      <div className="grid grid-cols-5 gap-1">
        {[
          { v: calories, set: setCalories, ph: 'kcal' },
          { v: protein,  set: setProtein,  ph: 'Protein' },
          { v: carbs,    set: setCarbs,    ph: 'Carbs' },
          { v: fat,      set: setFat,      ph: 'Fat' },
          { v: sugar,    set: setSugar,    ph: 'Sugar' },
        ].map((m, i) => (
          <input key={i} value={m.v} onChange={e => m.set(e.target.value)} placeholder={m.ph} inputMode="decimal"
            className="min-h-[36px] bg-white border border-ink-200 rounded-lg px-1 text-[11px] text-center" />
        ))}
      </div>
      <div className="flex gap-1.5 mt-0.5">
        <button onClick={onCancel} className="flex-1 min-h-[32px] text-[11px] text-ink-500 hover:bg-ink-100 rounded-lg">Cancel</button>
        <button onClick={handleCreate} disabled={saving} className="flex-1 min-h-[32px] text-[11px] bg-accent-500 text-white rounded-lg hover:bg-accent-600 disabled:opacity-50">
          {saving ? '…' : 'Create'}
        </button>
      </div>
    </div>
  )
}
