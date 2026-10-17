import { useMemo, useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, MetaLine } from '../../../shared/ui'
import { useRecipeBatch } from '../hooks/useRecipes'
import { recipeSnapshot } from '../foodBasket'
import { countLabel, portionWord, recipeAmountModel } from '../foodAmount'
import { AmountField } from './AmountField'
import { RecipeBatchPanel } from './RecipeBatch'
import type { RecipeWithIngredients } from '../types'

// The portion chooser for a saved meal (Food point 8.1): a stacked local
// sheet (a bottom sheet on the phone, THEME §8 "a portion chooser") instead
// of a picker drawn at the top of the logger, out of view when the meal was
// tapped lower down. The amount in the recipe's own units (AmountField),
// what it adds up to, what is left of the batch; Log logs it now (the logger
// stays open), Add to meal puts "Køfte · 3 pieces" in the basket.

export function RecipePortionSheet({ recipe, initial, last, busy = false, onClose, onLog, onAdd, addLabel = 'Add to meal' }: {
  recipe: RecipeWithIngredients
  /** Servings to start with (an amount already in the basket); else last time's, else one. */
  initial?: number
  /** Servings eaten last time, for its chip. */
  last?: number | null
  busy?: boolean
  onClose: () => void
  /** Logs it now; without it the sheet only sets the basket's amount (`onAdd` is then the primary). */
  onLog?: (servings: number) => void
  onAdd?: (servings: number) => void
  addLabel?: string
}) {
  const batch = useRecipeBatch(recipe)
  const model = useMemo(() => recipeAmountModel(recipe, batch), [recipe, batch])
  const [servings, setServings] = useState(initial ?? (last && last > 0 ? last : 1))
  const m = recipeSnapshot(recipe, servings)
  const word = portionWord(recipe.serving_label)
  const amount = countLabel(servings, word)
  const ok = servings > 0

  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      title={recipe.title}
      subtitle={recipe.calories != null
        ? `${Math.round(recipe.calories)} kcal · ${Math.round(recipe.protein_g ?? 0)} g protein per ${word}`
        : 'No macros yet'}
      footer={
        <div className="flex gap-2 sm:justify-end">
          {onAdd && onLog && <Button className="flex-1 sm:flex-none" onClick={() => onAdd(servings)} disabled={!ok}>{addLabel}</Button>}
          {onLog
            ? <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => onLog(servings)} loading={busy} disabled={!ok}>Log {amount}</Button>
            : onAdd && <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => onAdd(servings)} disabled={!ok}>{addLabel}</Button>}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <AmountField model={model} value={servings} onChange={setServings} last={last} batch={batch} id="portion-amount" />
        <MetaLine className="text-meta text-fg-muted tabular-nums" items={[
          <><strong className="text-fg">{Math.round(m.calories ?? 0)}</strong> kcal</>,
          `${Math.round(m.protein_g ?? 0)} g protein`,
          `${Math.round(m.carbs_g ?? 0)} g carbs`,
          `${Math.round(m.fat_g ?? 0)} g fat`,
        ]} />
        <RecipeBatchPanel recipe={recipe} batch={batch} thisServings={servings} />
      </div>
    </ModalShell>
  )
}
