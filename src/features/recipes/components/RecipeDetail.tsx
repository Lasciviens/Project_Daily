import { useState } from 'react'
import { Check, ChefHat, Flame, Minus, Plus, ShoppingBag, UtensilsCrossed, ExternalLink } from 'lucide-react'
import { toast } from '../../../app/store'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { Button, IconButton } from '../../../shared/ui'
import { cx } from '../../../shared/ui/cx'
import { useDeleteRecipe, useIncrementTimesCooked } from '../hooks/useRecipes'
import { useAddMissingIngredientsToShop } from '../hooks/useShopIntegration'
import { useAddFoodLogEntries } from '../hooks/useFoodLog'
import { recipeSnapshot } from '../api/foodLogApi'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { MacroBar } from './MacroBar'
import { CookMode } from './CookMode'
import type { RecipeWithIngredients, MealSlot } from '../types'

function slotForNow(): MealSlot {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

const LOG_SLOTS: { slot: MealSlot; label: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast' },
  { slot: 'lunch',      label: 'Lunch' },
  { slot: 'dinner',     label: 'Dinner' },
  { slot: 'snack',      label: 'Snack' },
  { slot: 'supplement', label: 'Supplement' },
]

interface Props {
  recipe: RecipeWithIngredients
  onClose: () => void
  /** Defaults to opening the shared `recipe` editor popup. */
  onEdit?: (recipe: RecipeWithIngredients) => void
}

// Scale a base quantity by the serving factor and print it cleanly (max 2
// decimals, trailing zeros stripped). null quantity = "to taste" → blank.
function scaledQty(q: number | null, factor: number): string {
  if (q == null) return ''
  const v = q * factor
  return (Math.round(v * 100) / 100).toString()
}

export function RecipeDetail({ recipe, onClose, onEdit }: Props) {
  const [servings, setServings] = useState(recipe.servings)
  const [ate, setAte] = useState(1)   // portions EATEN (≠ recipe base yield)
  // "I ate this" target — defaults to today + the time-of-day slot, but both are
  // editable so a past meal can be backfilled to the right day/slot.
  const [logDate, setLogDate] = useState(formatLocalDate(new Date()))
  const [logSlot, setLogSlot] = useState<MealSlot>(slotForNow())
  const [have,      setHave]     = useState<Set<string>>(new Set())
  const [cookMode,  setCookMode] = useState(false)
  const [imgError,  setImgError] = useState(false)
  const remove       = useDeleteRecipe()
  const addToShop    = useAddMissingIngredientsToShop()
  const cooked        = useIncrementTimesCooked()
  const logFood       = useAddFoodLogEntries()
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1

  function handleMadeThis() {
    cooked.mutate({ id: recipe.id, current: recipe.times_cooked })
  }

  // Log this recipe to the diary as ONE named line (recipe_id + a macro
  // snapshot at the selected servings) — this is what finally connects the
  // recipe library to calorie tracking. Day + slot are user-editable (default
  // today + time-of-day) so a past meal can be backfilled.
  function handleLog() {
    logFood.mutate([{
      date: logDate, meal_slot: logSlot,
      recipe_id: recipe.id, quantity: ate, unit: 'serving',
      ...recipeSnapshot(recipe, ate),
    }])
  }

  function toggleHave(id: string) {
    setHave(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleAddMissingToShop() {
    const missing = recipe.ingredients.filter(i => !have.has(i.id))
    if (!missing.length) { toast.warning('Everything is checked off — nothing to add'); return }
    // REAL BUG, fixed: every ON-SCREEN quantity already scales by `factor`
    // (via `scaledQty`), but this used to push the recipe's RAW base
    // quantities to Shop unscaled — double a batch before shopping and the
    // pushed list still showed the original (half) amounts.
    const missingScaled = missing.map(i => ({
      ...i,
      quantity: i.quantity == null ? null : Math.round(i.quantity * factor * 100) / 100,
    }))
    addToShop.mutate({ ingredients: missingScaled, recipeTitle: recipe.title })
  }

  const macro = (perServing: number | null) =>
    perServing == null ? null : Math.round(perServing * servings)

  async function handleDelete() {
    const ok = await entityModal.confirm({ title: `Delete "${recipe.title}"?`, message: "This can't be undone.", confirmLabel: 'Delete recipe' })
    if (!ok) return
    remove.mutate(recipe.id, { onSuccess: onClose })
  }

  function handleEdit() {
    if (onEdit) { onEdit(recipe); return }
    onClose()
    entityModal.open({ kind: 'recipe', id: recipe.id })
  }

  const steps = (recipe.instructions ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  const totals = [
    { label: 'Calories', v: macro(recipe.calories) },
    { label: 'Protein', v: macro(recipe.protein_g), suffix: 'g' },
    { label: 'Carbs', v: macro(recipe.carbs_g), suffix: 'g' },
    { label: 'Fat', v: macro(recipe.fat_g), suffix: 'g' },
    { label: 'Fiber', v: macro(recipe.fiber_g), suffix: 'g' },
    { label: 'Sugar', v: macro(recipe.sugar_g), suffix: 'g' },
  ].filter(t => t.v != null)

  const hasImage = !!recipe.image_url && !imgError

  const stepper = 'icon-btn-bordered'

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      title={hasImage ? undefined : recipe.title}
      subtitle={hasImage ? undefined : recipe.description ?? undefined}
      hero={hasImage ? (
        <div className="relative aspect-[16/9] w-full">
          <img src={recipe.image_url!} alt="" onError={() => setImgError(true)} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-scrim/80 via-scrim/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            {recipe.times_cooked > 0 && (
              <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-scrim/50 px-2 py-0.5 text-meta font-semibold text-white backdrop-blur-sm">
                <Flame className="h-3.5 w-3.5" aria-hidden /> Made {recipe.times_cooked}×
              </span>
            )}
            <h2 className="text-title font-semibold text-white">{recipe.title}</h2>
            {recipe.description && <p className="line-clamp-2 text-meta text-white/80">{recipe.description}</p>}
          </div>
        </div>
      ) : undefined}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="text-danger" onClick={handleDelete} loading={remove.isPending}>Delete</Button>
          <Button variant="primary" block onClick={handleEdit}>Edit recipe</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Serving scaler + cook actions. Phones: the action cluster drops to
            its own row; Cook mode is icon-only below sm. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2">
            <span className="section-label">Servings</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Fewer servings" onClick={() => setServings(s => Math.max(1, s - 1))} className={stepper}><Minus className="h-4 w-4" aria-hidden /></button>
              <span className="w-10 text-center text-ui font-bold text-fg tabular-nums">{servings}</span>
              <button type="button" aria-label="More servings" onClick={() => setServings(s => s + 1)} className={stepper}><Plus className="h-4 w-4" aria-hidden /></button>
            </div>
            {servings !== recipe.servings && (
              <button type="button" onClick={() => setServings(recipe.servings)} className="min-h-[44px] px-1 text-meta font-semibold text-accent-600">Reset</button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:flex-nowrap">
            {/* Portions EATEN — free entry (0.3, 1.5, 2…), not just ±0.5 steps. */}
            <div className="flex items-center overflow-hidden rounded-control border border-line bg-surface-2">
              <button type="button" onClick={() => setAte(a => Math.max(0.1, Math.round((a - 0.5) * 10) / 10))} aria-label="Fewer portions eaten"
                className="grid min-h-[44px] min-w-[36px] place-items-center text-fg-2 hover:bg-surface-hover"><Minus className="h-4 w-4" aria-hidden /></button>
              <input value={ate} aria-label="Portions eaten" inputMode="decimal"
                onChange={e => { const n = Number(e.target.value.replace(',', '.')); setAte(Number.isFinite(n) && n > 0 ? n : 0) }}
                className="min-h-[44px] w-10 bg-transparent text-center text-body font-bold text-fg tabular-nums focus:outline-none" />
              <button type="button" onClick={() => setAte(a => Math.round((a + 0.5) * 10) / 10)} aria-label="More portions eaten"
                className="grid min-h-[44px] min-w-[36px] place-items-center text-fg-2 hover:bg-surface-hover"><Plus className="h-4 w-4" aria-hidden /></button>
            </div>
            <Button variant="primary" size="sm" icon={<UtensilsCrossed />} onClick={handleLog} loading={logFood.isPending} disabled={ate <= 0}
              title="Log the eaten portions to the diary">
              I ate this
            </Button>
            {steps.length > 0 && (
              <Button size="sm" icon={<ChefHat />} onClick={() => setCookMode(true)} aria-label="Cook mode">
                <span className="hidden sm:inline">Cook mode</span>
              </Button>
            )}
            <IconButton label="I made this (counter only)" bordered onClick={handleMadeThis} disabled={cooked.isPending}>
              <Flame />
            </IconButton>
          </div>
        </div>

        {/* When + where "I ate this" logs to — defaults to today + the
            time-of-day slot, both editable so a past meal can be backfilled. */}
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          <span className="section-label">Log to</span>
          <input type="date" value={logDate} max={formatLocalDate(new Date())} onChange={e => setLogDate(e.target.value)}
            aria-label="Log date" className="input w-auto" />
          <select value={logSlot} onChange={e => setLogSlot(e.target.value as MealSlot)} aria-label="Meal slot" className="select w-auto">
            {LOG_SLOTS.map(s => <option key={s.slot} value={s.slot}>{s.label}</option>)}
          </select>
        </div>

        {/* What "I ate this" will log. Divides by the currently-scaled
            `servings` (not the recipe's base yield) — the "% of the batch"
            used to double when the batch was scaled up. */}
        {ate > 0 && (recipe.calories != null || servings > 1) && (
          <p className="-mt-2 text-meta text-fg-muted tabular-nums">
            Eating <strong className="text-fg-2">{ate}</strong> of {servings} portion{servings === 1 ? '' : 's'}
            {servings > 0 && <span> · {Math.round((ate / servings) * 100)}% of the batch</span>}
            {recipe.calories != null && <span> · logs <strong className="text-fg-2">{Math.round(recipe.calories * ate)}</strong> kcal</span>}
          </p>
        )}

        {/* Macros (scaled to selected servings) */}
        {totals.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {totals.map(t => (
              <div key={t.label} className="rounded-row bg-surface-2 py-2 text-center">
                <div className="text-ui font-bold text-fg tabular-nums">{t.v}{t.suffix ?? ''}</div>
                <div className="text-micro text-fg-muted">{t.label}</div>
              </div>
            ))}
          </div>
        )}
        {totals.length > 0 && <MacroBar protein={macro(recipe.protein_g)} carbs={macro(recipe.carbs_g)} fat={macro(recipe.fat_g)} />}

        {/* Ingredients — checkbox = "I already have this" */}
        {recipe.ingredients.length > 0 && (
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="section-label">Ingredients</h3>
              <span className="text-meta text-fg-muted">Check what you already have</span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {recipe.ingredients.map(ing => {
                const checked = have.has(ing.id)
                return (
                  <li key={ing.id}>
                    <button
                      type="button" onClick={() => toggleHave(ing.id)} aria-pressed={checked}
                      className={cx('row row-interactive w-full px-1.5 text-left text-body', checked && 'opacity-50')}
                    >
                      <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border-2', checked ? 'border-accent-500 bg-accent-500' : 'border-line-strong')}>
                        {checked && <Check aria-hidden strokeWidth={3} className="h-3 w-3 text-on-accent" />}
                      </span>
                      <span className={cx('min-w-[3rem] font-medium text-fg tabular-nums', checked && 'line-through')}>
                        {scaledQty(ing.quantity, factor)} {ing.unit ?? ''}
                      </span>
                      <span className={cx('flex-1 text-fg-2', checked && 'line-through')}>
                        {ing.name}{ing.note ? <span className="text-fg-muted"> · {ing.note}</span> : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <Button size="sm" block className="mt-2" icon={<ShoppingBag />} onClick={handleAddMissingToShop} loading={addToShop.isPending}>
              Add missing to Shop
            </Button>
          </section>
        )}

        {steps.length > 0 && (
          <section>
            <h3 className="section-label mb-1.5">Instructions</h3>
            <ol className="flex flex-col gap-2">
              {steps.map((st, i) => (
                <li key={i} className="flex gap-2 text-body text-fg-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-50 text-micro font-bold text-accent-700 tabular-nums">{i + 1}</span>
                  <span className="flex-1 leading-snug">{st}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {recipe.source_url && (
          <a href={recipe.source_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1 self-start text-meta font-semibold text-accent-600">
            Source <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>

      {cookMode && <CookMode recipe={recipe} steps={steps} onClose={() => setCookMode(false)} />}
    </ModalShell>
  )
}
