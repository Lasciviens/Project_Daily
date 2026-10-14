import { useMemo } from 'react'
import { Plus, Target } from 'lucide-react'
import { AnimatedNumber, Card, CardHeader, IconButton, Truncate, cx } from '../../../shared/ui'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { useAddFoodLogEntries } from '../hooks/useFoodLog'
import { useFoodUsage } from '../hooks/useFoodUsage'
import { ingredientSnapshot, recipeSnapshot } from '../api/foodLogApi'
import { dayMacroTargets, FAT_SHARE, macrosLeft, suggestForRemaining, type DayMacro, type FitSuggestion, type MacroLeft } from '../foodLibraryModel'
import { MACRO_COLOR } from '../macroColors'
import { slotForNow, SLOT_OPTIONS } from './foodLogUtils'

const LABEL: Record<DayMacro, string> = { kcal: 'Kcal', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' }
const COLOR: Record<DayMacro, string> = { kcal: MACRO_COLOR.calories, protein: MACRO_COLOR.protein, carbs: MACRO_COLOR.carbs, fat: MACRO_COLOR.fat }
// Over a target, said as it is: calories in the danger tone (like the ring),
// protein over is good news, carbs and fat are only a split of the calories.
const OVER_TEXT: Record<DayMacro, string> = { kcal: 'text-danger', protein: 'text-success', carbs: 'text-warn', fat: 'text-warn' }
const OVER_BAR: Record<DayMacro, string> = { kcal: 'rgb(var(--danger))', protein: 'rgb(var(--success))', carbs: 'rgb(var(--warn))', fat: 'rgb(var(--warn))' }

function LeftFigure({ m, ready }: { m: MacroLeft; ready: boolean }) {
  const over = m.left < 0
  const unit = m.key === 'kcal' ? 'kcal' : 'g'
  return (
    <div className="min-w-0" title={`${LABEL[m.key]}: ${Math.abs(m.left)} ${unit} ${over ? 'over' : 'left'} · ${m.eaten} of ${m.target} ${unit}`}>
      <p className="flex items-center gap-1 text-meta text-fg-muted">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR[m.key] }} />
        {LABEL[m.key]}
      </p>
      <p className="whitespace-nowrap tabular-nums">
        <span className={cx('text-ui font-semibold', over ? OVER_TEXT[m.key] : 'text-fg')}>
          {over && '+'}<AnimatedNumber value={Math.abs(m.left)} ready={ready} />{unit === 'g' && ' g'}
        </span>
        <span className="text-meta text-fg-muted"> {over ? 'over' : 'left'}</span>
      </p>
      <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.round(m.share * 100)}%`, backgroundColor: over ? OVER_BAR[m.key] : COLOR[m.key] }} />
      </div>
    </div>
  )
}

/**
 * "What's left": what the goal leaves for the rest of the day — kcal and
 * protein from the goal, carbs and fat as their split of the calories
 * (foodLibraryModel.dayMacroTargets) — with over a target shown as over. One
 * line under it suggests your own recipe or food whose one portion fits the
 * calories left and closes the most protein per kcal; + logs it.
 */
export function FitsLeftCard({ date, goal, eaten, fatFloorG }: {
  date: string
  goal: { calories: number; protein: number }
  /** The day's eaten totals; undefined while they load. */
  eaten: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | undefined
  /** The coach's fat floor (a cut with a known weight), else null. */
  fatFloorG: number | null
}) {
  const { data: recipes = [] } = useRecipes()
  const { data: foods = [] } = useIngredientLibrary()
  const { usage } = useFoodUsage()
  const add = useAddFoodLogEntries()
  const targets = dayMacroTargets(goal, fatFloorG)
  const left = macrosLeft(targets, eaten)
  const kcalLeft = left[0].left
  const proteinLeft = left[1].left
  const top = useMemo(
    () => suggestForRemaining({ recipes, foods, usage, kcalLeft, proteinLeft, limit: 1 })[0],
    [recipes, foods, usage, kcalLeft, proteinLeft],
  )
  const slot = date === todayStr() ? slotForNow() : 'snack'
  const slotName = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot
  const floorUsed = fatFloorG != null && fatFloorG > (targets.kcal * FAT_SHARE) / 9

  function log(s: FitSuggestion) {
    if (s.kind === 'recipe') {
      const r = recipes.find(x => x.id === s.id)
      if (!r) return
      add.mutate([{ date, meal_slot: slot, recipe_id: r.id, quantity: 1, unit: 'serving', ...recipeSnapshot(r, 1) }])
    } else {
      const f = foods.find(x => x.id === s.id)
      if (!f) return
      const unit = f.unit?.trim().toLowerCase() === 'ml' ? 'ml' : 'g'
      add.mutate([{ date, meal_slot: slot, library_ingredient_id: f.id, quantity: s.quantity, unit, ...ingredientSnapshot(f, s.quantity) }])
    }
  }

  return (
    <Card>
      <CardHeader title="What's left" variant="label" icon={<Target />}
        action={(
          <InfoBubble label="How these are worked out">
            What your goal leaves for the rest of the day. Kcal ({targets.kcal}) and protein ({targets.protein} g) are your goal.
            Carbs ({targets.carbs} g) and fat ({targets.fat} g) split the calories: fat {floorUsed ? `is the coach's ${targets.fat} g floor for a cut` : `${Math.round(FAT_SHARE * 100)} % of them`},
            carbs what protein and fat leave. “Fits” is your own recipe or food that fits the calories left with the most protein per kcal; + logs one portion to {slotName}.
          </InfoBubble>
        )} />
      <div className="grid grid-cols-4 gap-2">
        {left.map(m => <LeftFigure key={m.key} m={m} ready={eaten != null} />)}
      </div>
      {top && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-2" title={`${top.portion} · ${top.kcal} kcal · ${top.protein} g protein`}>
          <span className="shrink-0 text-meta text-fg-muted">Fits</span>
          <Truncate className="min-w-0 flex-1 text-body font-medium text-fg">{top.title}</Truncate>
          <span className="shrink-0 whitespace-nowrap text-meta tabular-nums text-fg-muted">{top.kcal} kcal · {top.protein} g protein</span>
          <IconButton label={`Log ${top.title} (${top.portion}) to ${slotName}`} onClick={() => log(top)} className="-my-1 -mr-2 shrink-0 text-accent-600"><Plus /></IconButton>
        </div>
      )}
    </Card>
  )
}
