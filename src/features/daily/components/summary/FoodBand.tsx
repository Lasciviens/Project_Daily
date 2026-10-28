import { useState } from 'react'
import { Beef, Droplet, Flame, Nut, UtensilsCrossed, Wheat } from 'lucide-react'
import { Cell, CellHeader, StatBox, StatEmpty, StatNote, StatValue } from './cellKit'
import { FoodDayPopup } from './FoodDayPopup'
import { cx, type Tone } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useDayNutrition } from '../../hooks/useDayNutrition'
import { useDayTargets } from '../../hooks/useDayTargets'
import { useNutritionCoach } from '../../hooks/useNutritionCoach'
import { useWaterDay } from '../../hooks/useWater'
import { dayMacroTargets } from '../../../health/goal/cutDecision'
import { dayFoodTotals, litres } from '../../foodGlance'
import { MACRO_COLOR } from '../../../recipes/macroColors'

// Personal's food summary (owner, 26.10.2026: "Just a clear summary of food,
// which opens a bigger popup with details. Calories, macros.. Water.."):
// five boxes — calories, protein, carbs, fat, water — against the goal, the
// same numbers as Food · Today (its eaten totals, the goal, the worked-out
// carb and fat goals). A tap opens the day's details; logging food stays on
// the Food page. A day still to come shows what is planned for it.

// Food's colours (food rules): a macro's own colour only on that macro
// (MACRO_COLOR), calories over the goal danger, protein reached success.
function Bar({ value, tone, color }: { value: number; tone?: Tone; color?: string }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
      <div data-tone={tone} className={cx('h-full rounded-full transition-[width] duration-300', tone ? 'tone-solid' : !color && 'bg-fg-faint')}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, ...(!tone && color ? { background: color } : {}) }} />
    </div>
  )
}

export function FoodBand({ date }: { date: string }) {
  const [open, setOpen] = useState(false)
  const nut = useDayNutrition(date)
  const { targets } = useDayTargets()
  const coach = useNutritionCoach(targets)
  const water = useWaterDay(date)
  const goal = dayMacroTargets(targets, coach.fatFloorG)
  const totals = dayFoodTotals(nut.data?.meals ?? [], date, todayStr())
  const waterGoal = targets.water > 0 ? targets.water : 2000
  const ml = water.data ?? 0
  const loading = nut.isLoading
  const kcalLeft = goal.kcal - totals.calories
  const show = () => setOpen(true)
  const name = (what: string) => `${what} — open the day's food`

  return (
    <Cell>
      <CellHeader icon={<UtensilsCrossed />} title="Food" action={
        <button type="button" onClick={show}
          className="flex min-h-[44px] shrink-0 items-center px-1.5 text-meta font-semibold text-accent-600 transition-colors hover:text-accent-700">
          Details
        </button>
      } />
      {nut.isError && <p className="text-meta text-fg-muted">Couldn't load the day's food — the numbers below may be missing some of it.</p>}
      <div className="@container">
        <div className="grid grid-cols-2 gap-2 @[25rem]:grid-cols-3 @[40rem]:grid-cols-5">
          <StatBox icon={<Flame aria-hidden />} label={totals.planned ? 'Calories · planned' : 'Calories'} onClick={show} ariaLabel={name('Calories')}>
            {loading ? <StatEmpty loading /> : (
              <>
                <StatValue tone={kcalLeft < 0 ? 'danger' : undefined}>{totals.calories}</StatValue>
                <StatNote>of {goal.kcal} kcal</StatNote>
                <Bar value={goal.kcal ? totals.calories / goal.kcal : 0} tone={kcalLeft < 0 ? 'danger' : undefined} color={MACRO_COLOR.calories} />
              </>
            )}
          </StatBox>
          <StatBox icon={<Beef aria-hidden />} label="Protein" onClick={show} ariaLabel={name('Protein')}>
            {loading ? <StatEmpty loading /> : (
              <>
                <StatValue tone={goal.protein > 0 && totals.protein_g >= goal.protein ? 'success' : undefined}>{totals.protein_g} g</StatValue>
                <StatNote>of {goal.protein} g</StatNote>
                <Bar value={goal.protein ? totals.protein_g / goal.protein : 0} tone={goal.protein > 0 && totals.protein_g >= goal.protein ? 'success' : undefined} color={MACRO_COLOR.protein} />
              </>
            )}
          </StatBox>
          <StatBox icon={<Wheat aria-hidden />} label="Carbs" onClick={show} ariaLabel={name('Carbs')}>
            {loading ? <StatEmpty loading /> : (
              <>
                <StatValue>{totals.carbs_g} g</StatValue>
                <StatNote>of {goal.carbs} g</StatNote>
                <Bar value={goal.carbs ? totals.carbs_g / goal.carbs : 0} color={MACRO_COLOR.carbs} />
              </>
            )}
          </StatBox>
          <StatBox icon={<Nut aria-hidden />} label="Fat" onClick={show} ariaLabel={name('Fat')}>
            {loading ? <StatEmpty loading /> : (
              <>
                <StatValue>{totals.fat_g} g</StatValue>
                <StatNote>of {goal.fat} g</StatNote>
                <Bar value={goal.fat ? totals.fat_g / goal.fat : 0} color={MACRO_COLOR.fat} />
              </>
            )}
          </StatBox>
          {/* The fifth box fills its row (2 and 3 columns leave one or two cells free), as on Health. */}
          <StatBox icon={<Droplet aria-hidden />} label="Water" onClick={show} ariaLabel={name('Water')} className="col-span-2 @[40rem]:col-span-1">
            {water.isLoading ? <StatEmpty loading /> : (
              <>
                <StatValue tone={ml >= waterGoal ? 'success' : undefined}>{litres(ml)} L</StatValue>
                <StatNote>of {litres(waterGoal)} L</StatNote>
                <Bar value={ml / waterGoal} tone={ml >= waterGoal ? 'success' : 'info'} />
              </>
            )}
          </StatBox>
        </div>
      </div>
      {open && <FoodDayPopup date={date} onClose={() => setOpen(false)} />}
    </Cell>
  )
}
