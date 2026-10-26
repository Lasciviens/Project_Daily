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
import { dayMacroTargets, FAT_SHARE, type DayMacroTargets } from '../../health/goal/cutDecision'
import { macrosLeft, suggestForRemaining, type DayMacro, type FitSuggestion, type MacroLeft } from '../foodLibraryModel'
import { MACRO_COLOR } from '../macroColors'
import { slotForNow, SLOT_OPTIONS } from './foodLogUtils'

const LABEL: Record<DayMacro, string> = { kcal: 'Kcal', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' }
const COLOR: Record<DayMacro, string> = { kcal: MACRO_COLOR.calories, protein: MACRO_COLOR.protein, carbs: MACRO_COLOR.carbs, fat: MACRO_COLOR.fat }
// Over a target, said as it is: calories in the danger tone (like the ring),
// protein over is good news, over the owner's own carb or fat goal a warning.
// Over a worked-out carb or fat target (not the owner's) stays neutral.
const OVER_TEXT: Record<DayMacro, string> = { kcal: 'text-danger', protein: 'text-success', carbs: 'text-warn', fat: 'text-warn' }
const OVER_BAR: Record<DayMacro, string> = { kcal: 'rgb(var(--danger))', protein: 'rgb(var(--success))', carbs: 'rgb(var(--warn))', fat: 'rgb(var(--warn))' }

/** Whether going over this target is judged: kcal and protein always, carbs and fat only when the owner set them. */
const judged = (key: DayMacro, t: DayMacroTargets) => (key === 'carbs' ? t.carbsSet : key === 'fat' ? t.fatSet : true)

function LeftFigure({ m, ready, judgedOver }: { m: MacroLeft; ready: boolean; judgedOver: boolean }) {
  const over = m.left < 0
  const toned = over && judgedOver
  const unit = m.key === 'kcal' ? 'kcal' : 'g'
  return (
    <div className="min-w-0" title={`${LABEL[m.key]}: ${Math.abs(m.left)} ${unit} ${over ? 'over' : 'left'} · ${m.eaten} of ${m.target} ${unit}`}>
      <p className="flex items-center gap-1 text-meta text-fg-muted">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR[m.key] }} />
        {LABEL[m.key]}
      </p>
      {/* On a narrow phone "over" / "left" drops under the number instead of running into the next column. */}
      <p className="tabular-nums">
        <span className={cx('whitespace-nowrap text-ui font-semibold', toned ? OVER_TEXT[m.key] : 'text-fg')}>
          {over && '+'}<AnimatedNumber value={Math.abs(m.left)} ready={ready} />{unit === 'g' && ' g'}
        </span>
        <span className="text-meta text-fg-muted"> {over ? 'over' : 'left'}</span>
      </p>
      <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.round(m.share * 100)}%`, backgroundColor: toned ? OVER_BAR[m.key] : COLOR[m.key] }} />
      </div>
    </div>
  )
}

/** The ⓘ's sentence about carbs and fat: which are the owner's goals, which are worked out and how. */
function carbFatText(t: DayMacroTargets): string {
  const set = [t.carbsSet && `carbs (${t.carbs} g)`, t.fatSet && `fat (${t.fat} g)`].filter(Boolean)
  const worked = [
    !t.fatSet && `fat (${t.fat} g) is ${t.fatFromFloor ? 'the coach’s floor for a cut' : `${Math.round(FAT_SHARE * 100)} % of the calories`}`,
    !t.carbsSet && `carbs (${t.carbs} g) are what protein and fat leave`,
  ].filter(Boolean)
  const parts: string[] = []
  if (set.length) parts.push(`${t.carbsSet ? 'So are' : 'So is'} ${set.join(' and ')}.`)
  if (worked.length) parts.push(`Worked out for you, since your goal has none: ${worked.join('; ')} — set your own in Your goal. Going over a worked-out number isn’t flagged.`)
  return parts.join(' ')
}

/**
 * "What's left": what the goal leaves for the rest of the day — kcal and
 * protein from the goal, carbs and fat the owner's own goals or worked out
 * from the rest (health/goal/cutDecision.dayMacroTargets) — with over a target
 * shown as over. One line under it suggests your own recipe or food whose one
 * portion fits the calories left and closes the most protein per kcal; + logs it.
 */
export function FitsLeftCard({ date, goal, eaten, fatFloorG }: {
  date: string
  goal: { calories: number; protein: number; carbs: number | null; fat: number | null }
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
  // Plain numbers (the same as left[0] and left[1]) so the memo's inputs are primitives.
  const kcalLeft = targets.kcal - Math.round(eaten?.calories ?? 0)
  const proteinLeft = targets.protein - Math.round(eaten?.protein_g ?? 0)
  const top = useMemo(
    () => suggestForRemaining({ recipes, foods, usage, kcalLeft, proteinLeft, limit: 1 })[0],
    [recipes, foods, usage, kcalLeft, proteinLeft],
  )
  const slot = date === todayStr() ? slotForNow() : 'snack'
  const slotName = SLOT_OPTIONS.find(o => o.id === slot)?.label.toLowerCase() ?? slot

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
            {' '}{carbFatText(targets)}
            {' '}“Fits” is your own recipe or food that fits the calories left with the most protein per kcal; + logs one portion to {slotName}.
          </InfoBubble>
        )} />
      <div className="grid grid-cols-4 gap-2">
        {left.map(m => <LeftFigure key={m.key} m={m} ready={eaten != null} judgedOver={judged(m.key, targets)} />)}
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
