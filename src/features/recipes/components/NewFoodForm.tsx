import { useState } from 'react'
import { Button } from '../../../shared/ui'
import { useCreateIngredientLibraryItem, useUpsertExternalFood } from '../hooks/useIngredientLibrary'
import { checkMacroConsistency } from '../macroSanity'
import { MacroWarningBadge } from './MacroWarningBadge'
import { FoodThumb } from './foodLogKit'
import { sanitizeDecimal } from './foodLogUtils'
import type { BarcodeProduct } from '../api/openFoodFactsApi'
import type { IngredientLibraryItem } from '../types'

/** What the form opens with: a typed name, or a scanned / searched product to review. */
export type NewFoodSeed = { name: string; product?: BarcodeProduct | null }

const str = (v: number | null | undefined) => (v != null ? String(v) : '')
const num = (s: string) => (s === '' ? null : Number(s))

/**
 * A new library food, per 100 g — typed, or a scanned / online product
 * reviewed before it's saved (deduped by its source reference). Shared by the
 * logger and the recipe builder; remount it (`key`) for a new seed.
 */
export function NewFoodForm({ seed, onCreated, onCancel, submitLabel = 'Add to meal' }: {
  seed: NewFoodSeed
  onCreated: (item: IngredientLibraryItem) => void
  onCancel: () => void
  submitLabel?: string
}) {
  const createIngredient = useCreateIngredientLibraryItem()
  const upsertExternal = useUpsertExternalFood()
  const p = seed.product ?? null
  const [name, setName] = useState(p?.name ?? seed.name)
  const [kcal, setKcal] = useState(str(p?.calories)); const [prot, setProt] = useState(str(p?.protein_g))
  const [carb, setCarb] = useState(str(p?.carbs_g)); const [fat, setFat] = useState(str(p?.fat_g))
  const [fiber, setFiber] = useState(str(p?.fiber_g))
  const [sugar, setSugar] = useState(str(p?.sugar_g))
  const [servLabel, setServLabel] = useState(p?.serving_grams != null ? '1 serving' : '')
  const [servGrams, setServGrams] = useState(str(p?.serving_grams))

  async function handleCreate() {
    if (!name.trim()) return
    const input = {
      name, calories: num(kcal), protein_g: num(prot), carbs_g: num(carb),
      fat_g: num(fat), fiber_g: num(fiber), sugar_g: num(sugar),
      serving_label: servLabel || null, serving_grams: num(servGrams),
    }
    try {
      const created = p
        ? await upsertExternal.mutateAsync({ ...input, source: p.source ?? 'openfoodfacts', source_ref: p.code, image_url: p.image_url })
        : await createIngredient.mutateAsync(input)
      onCreated(created)
    } catch { return }   // the hook already toasted + logged
  }

  const check = checkMacroConsistency(num(kcal), num(prot), num(carb), num(fat))
  return (
    <div className="flex flex-col gap-2 rounded-card border border-accent-500/25 bg-accent-50 p-3.5">
      <div className="flex items-center gap-2">
        {p?.image_url && <FoodThumb name={name} imageUrl={p.image_url} size={36} />}
        <p className="text-meta font-semibold text-accent-700">New ingredient · per 100g (one-time — reusable forever)</p>
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" className="input" />
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { v: kcal, set: setKcal, ph: 'kcal' },
          { v: prot, set: setProt, ph: 'Protein' },
          { v: carb, set: setCarb, ph: 'Carbs' },
          { v: fat, set: setFat, ph: 'Fat' },
          { v: fiber, set: setFiber, ph: 'Fiber' },
          { v: sugar, set: setSugar, ph: 'Sugar' },
        ].map(m => (
          <input key={m.ph} value={m.v} onChange={e => m.set(sanitizeDecimal(e.target.value))} inputMode="decimal"
            placeholder={m.ph} aria-label={m.ph} className="input tabular-nums" />
        ))}
      </div>
      {check?.inconsistent && (
        <div data-tone="warn" className="tone-text flex items-center gap-1.5 text-meta">
          <MacroWarningBadge result={check} />
          <span>Calories don't match protein/carbs/fat — {check.deltaPct}% off. Tap the badge for details.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <input value={servLabel} onChange={e => setServLabel(e.target.value)} placeholder="Portion label (1 scoop)" aria-label="Portion label" className="input" />
        <input value={servGrams} onChange={e => setServGrams(sanitizeDecimal(e.target.value))} inputMode="decimal" placeholder="= grams" aria-label="Portion grams" className="input" />
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" block onClick={handleCreate} loading={createIngredient.isPending || upsertExternal.isPending} disabled={!name.trim()}>{submitLabel}</Button>
      </div>
    </div>
  )
}
