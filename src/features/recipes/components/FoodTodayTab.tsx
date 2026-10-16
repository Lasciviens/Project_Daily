import { useState } from 'react'
import { Brain, Check, ChevronRight, Copy, Plus, X } from 'lucide-react'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { GoalSummary } from '../../daily/components/GoalSummary'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { useNutritionCoach } from '../../daily/hooks/useNutritionCoach'
import { CoachDecisionView } from '../../daily/components/CoachDecision'
import { coachShort } from '../../health/goal/cutDecision'
import { useRemoveFoodLogEntries, useRecentFoods, useAddFoodLogEntries } from '../hooks/useFoodLog'
import { recentToEntry } from '../api/foodLogApi'
import { usualForSlot } from '../foodSearch'
import { useCopyYesterdayMeals } from '../../daily/hooks/useQuickMeals'
import { FitsLeftCard } from './FitsLeftCard'
import { RecentDaysCard } from './RecentDaysCard'
import { QuickGuessCard } from './QuickGuessCard'
import { useEatPlannedEntry } from '../hooks/useMealPlan'
import { MacroBar } from './MacroBar'
import { MacroFigure } from './MacroTotalPeek'
import { splitTitleQty } from '../foodIngredients'
import { WaterTracker } from '../../daily/components/summary/WaterTracker'
import { AnimatedNumber, Card, CardHeader, IconButton, MetaLine, PageBoard, ProgressRing, TonePill, Truncate, cx } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { MACRO_COLOR } from '../macroColors'
import type { MealSlot } from '../types'
import { groupDayMeals, type DayMeal, type MealGroupRow } from '../../daily/api/dayNutritionApi'
import { useNewIds } from '../../../shared/hooks/useNewIds'
import { FOOD_TODAY_BOARD } from '../foodBoards'
import { DishItemMenu, DishMenu } from './DishActions'

// The wide meal-row grid: name · amount · kcal · protein · carbs · fat · fiber · ✓ · ✕.
// Shared by the rows and their column-heading row so the two always line up.
const MACRO_GRID = 'hidden items-center gap-x-2 @[40rem]:grid @[40rem]:grid-cols-[minmax(0,1fr)_3.5rem_3rem_3.25rem_3rem_3rem_3rem_2.75rem_2.75rem]'

// ─────────────────────────────────────────────────────────────────────────────
//  Food · Today — the full nutrition surface. The day's totals, water and the
//  quick-log cards beside the meal slots, the last days and the coach under
//  them, placed per width by FOOD_TODAY_BOARD
//  (foodBoards.ts). A check on a PLANNED row confirms it as
//  EATEN so it starts counting toward the day.
// ─────────────────────────────────────────────────────────────────────────────

const SLOTS: { slot: MealSlot; label: string; icon: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast',  icon: '🌅' },
  { slot: 'lunch',      label: 'Lunch',      icon: '☀️' },
  { slot: 'dinner',     label: 'Dinner',     icon: '🌙' },
  { slot: 'snack',      label: 'Snack',      icon: '🍎' },
  { slot: 'supplement', label: 'Supplement', icon: '💊' },
]

// `size` is the SVG geometry basis; `sizeClass` sets the displayed box so the
// ring can shrink on a phone (the viewBox scales the stroke with it).
function Ring({ consumed, target, size, stroke, color, label, sizeClass, ready }: {
  consumed: number; target: number; size: number; stroke: number; color: string; label: string; sizeClass: string; ready: boolean
}) {
  const over = consumed > target
  const remaining = Math.abs(Math.round(target - consumed))
  return (
    <ProgressRing value={target > 0 ? consumed / target : 0} size={size} stroke={stroke} ready={ready}
      color={over ? 'rgb(var(--danger))' : color} className={sizeClass}>
      <AnimatedNumber value={remaining} ready={ready} align="center" className={cx('font-bold leading-none text-fg', size > 100 ? 'text-title sm:text-kpi' : 'text-ui sm:text-lead')} />
      <span className={cx('mt-0.5 text-micro leading-none', over ? 'text-danger' : 'text-fg-muted')}>{over ? 'over' : label}</span>
    </ProgressRing>
  )
}

const PLANNED_PILL = <TonePill tone="neutral" className="shrink-0">Planned</TonePill>

export function FoodTodayTab({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const modal = useEntityModal()
  const coach = useNutritionCoach(targets)
  const remove  = useRemoveFoodLogEntries()
  const copyYesterday = useCopyYesterdayMeals()
  const { data: recent = [] } = useRecentFoods()
  const addEntries = useAddFoodLogEntries()
  const eatPlan = useEatPlannedEntry()
  const [coachOpen, setCoachOpen] = useState(false)   // phone-only collapse
  // "As meal" groups expanded to their individual items (collapsed by default).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // A food logged while the day is open rises in (the motion set).
  const fresh = useNewIds((nut?.meals ?? []).map(m => m.id), date, nut != null)

  // The goal lives in the shared `day-targets` popup (draft → Save), shown
  // by GoalSummary. The Coach's "Apply" buttons stay one deliberate tap that
  // writes immediately.
  const openLog = (slot: MealSlot) => modal.open({ kind: 'food-log', date, slot })
  function applyProtein(g: number) { update({ protein: g }) }
  function applyCalories(kcal: number, adjustDate: string) { update({ calories: kcal, lastCalorieAdjust: adjustDate }) }
  function toggleGroup(id: string) {
    setExpandedGroups(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinLeft = Math.round(targets.protein - protein)
  const proteinHit  = targets.protein > 0 && proteinLeft <= 0

  // One-line status in the collapsed (phone) Coach header.
  const coachSummary = coach.weightKg == null ? (coach.isLoading ? '…' : 'Set up') : coachShort(coach.decision)

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []; arr.push(m); bySlot.set(m.meal_slot, arr)
  }

  // One logged/planned item, standalone or indented inside an expanded dish.
  // Two markups (stacked phone vs aligned desktop grid) because the column
  // count would otherwise change under one fixed set of children. Inside a
  // dish the ⋯ column offers Edit and "Move out of meal".
  function mealLine(meal: DayMeal, dish?: MealGroupRow) {
    const indent = !!dish
    const planned = meal.source === 'plan'
    const { name, qty } = splitTitleQty(meal.title)
    const onOpen = () => {
      if (planned) {
        if (meal.planEntry) modal.open({ kind: 'meal-plan', date, slot: meal.planEntry.meal_slot, entryId: meal.planEntry.id })
      } else {
        modal.open({ kind: 'food-log-edit', entryId: meal.id, date })
      }
    }
    const onDelete = () => void remove.run([meal.id], { title: `Remove “${name}”?`, done: `Removed ${name}` })
    const macroLine = [
      qty,
      meal.calories > 0 && `${meal.calories} kcal`,
      meal.protein_g > 0 && `${meal.protein_g}g protein`,
      meal.carbs_g > 0 && `${meal.carbs_g}g carbs`,
      meal.fat_g > 0 && `${meal.fat_g}g fat`,
      meal.fiber_g > 0 && `${meal.fiber_g}g fiber`,
    ]
    const nameBtn = (
      <button type="button" onClick={onOpen} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-accent-600">
        <Truncate className={planned ? 'italic text-fg-muted' : 'text-fg'}>{name}</Truncate>
        {planned && PLANNED_PILL}
      </button>
    )
    const actionBtn = planned && meal.planEntry ? (
      <IconButton label={`Mark ${name} eaten`} onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
        className="text-success disabled:opacity-50"><Check /></IconButton>
    ) : dish ? <DishItemMenu entryId={meal.id} item={name} dish={dish.title} date={date} /> : null
    const delBtn = (
      <IconButton label={`Remove ${name}`} onClick={onDelete} className="text-fg-faint hover:!text-danger"><X /></IconButton>
    )
    const num = 'text-meta tabular-nums text-right text-fg-muted'
    return (
      <li key={meal.id} className={cx(indent && 'bg-surface-2/60', fresh.has(meal.id) && 'motion-row-in')}>
        {/* Narrow card: name + actions, macro line underneath */}
        <div className="@[40rem]:hidden">
          <div className={cx('flex items-center gap-1 text-body', indent ? 'pl-9 pr-2' : 'pl-4 pr-2')}>
            {nameBtn}{actionBtn}{delBtn}
          </div>
          <MetaLine items={macroLine} className={cx('-mt-1.5 pb-2 text-meta tabular-nums text-fg-muted', indent ? 'pl-9 pr-4' : 'px-4')} />
        </div>

        {/* Wide card: every macro in its own aligned column */}
        <div className={cx(MACRO_GRID, 'text-body', indent ? 'pl-9 pr-2' : 'pl-4 pr-2')}>
          {nameBtn}
          <span className={num}>{qty ?? ''}</span>
          <span className={cx(num, !planned && 'font-medium text-fg-2')}>{meal.calories > 0 ? meal.calories : ''}</span>
          <span className={num}>{meal.protein_g > 0 ? `${meal.protein_g}g` : ''}</span>
          <span className={num}>{meal.carbs_g > 0 ? `${meal.carbs_g}g` : ''}</span>
          <span className={num}>{meal.fat_g > 0 ? `${meal.fat_g}g` : ''}</span>
          <span className={num}>{meal.fiber_g > 0 ? `${meal.fiber_g}g` : ''}</span>
          {actionBtn ?? <span />}
          {delBtn}
        </div>
      </li>
    )
  }

  // A dish (rows sharing a meal_group_id) as ONE row on the same columns as
  // the single rows: its name and item count, the summed amount and macros,
  // ⋯ (DishMenu) and ×; tap to expand into its items.
  function dishLine(group: MealGroupRow, slot: MealSlot) {
    const expanded = expandedGroups.has(group.groupId)
    const n = group.items.length
    const num = 'text-meta tabular-nums text-right text-fg-muted'
    const totals = [
      group.amount,
      `${group.calories} kcal`,
      group.protein_g > 0 && `${group.protein_g}g protein`,
      group.carbs_g > 0 && `${group.carbs_g}g carbs`,
      group.fat_g > 0 && `${group.fat_g}g fat`,
      group.fiber_g > 0 && `${group.fiber_g}g fiber`,
    ]
    const nameBtn = (
      <button type="button" onClick={() => toggleGroup(group.groupId)} aria-expanded={expanded}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-accent-600">
        <ChevronRight aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', expanded && 'rotate-90')} />
        <Truncate className="font-medium text-fg">{group.title}</Truncate>
        <span className="count-badge shrink-0" title={`${n} items`}>{n}<span className="sr-only"> items</span></span>
      </button>
    )
    const menu = <DishMenu group={group} date={date} slot={slot} />
    const delBtn = (
      <IconButton label={`Delete ${group.title} (${n} items)`} className="text-fg-faint hover:!text-danger"
        onClick={() => void remove.run(group.items.map(m => m.id), { title: `Delete “${group.title}”?`, message: `The whole meal: ${n} items.`, confirmLabel: 'Delete meal', done: `Removed ${group.title}` })}><X /></IconButton>
    )
    return (
      <li key={group.groupId} className={group.items.some(m => fresh.has(m.id)) ? 'motion-row-in' : undefined}>
        <div className="@[40rem]:hidden">
          <div className="flex items-center gap-1 pl-3 pr-2 text-body">{nameBtn}{menu}{delBtn}</div>
          <MetaLine items={totals} className="-mt-1.5 pb-2 pl-9 pr-4 text-meta tabular-nums text-fg-muted" />
        </div>
        <div className={cx(MACRO_GRID, 'pl-3 pr-2 text-body')}>
          {nameBtn}
          <span className={num}>{group.amount}</span>
          <span className={cx(num, 'font-medium text-fg-2')}>{group.calories}</span>
          <span className={num}>{group.protein_g > 0 ? `${group.protein_g}g` : ''}</span>
          <span className={num}>{group.carbs_g > 0 ? `${group.carbs_g}g` : ''}</span>
          <span className={num}>{group.fat_g > 0 ? `${group.fat_g}g` : ''}</span>
          <span className={num}>{group.fiber_g > 0 ? `${group.fiber_g}g` : ''}</span>
          <span className="grid place-items-center">{menu}</span>
          {delBtn}
        </div>
        {expanded && (
          <ul className="divide-y divide-line border-t border-line">
            {group.items.map(m => mealLine(m, group))}
          </ul>
        )}
      </li>
    )
  }

  return (
    // Placed by PageBoard (foodBoards.ts): the totals rail on the left, the meal slots in main.
    <PageBoard layout={FOOD_TODAY_BOARD} stackGap="gap-3 sm:gap-4" sections={{
      nutrition: (
        <Card>
          <CardHeader title="Nutrition" variant="label" />
          <GoalSummary date={date} className="-mt-2 mb-2" />
          <div className="flex flex-wrap items-center gap-4 sm:gap-5">
            <Ring consumed={consumed} target={targets.calories} size={134} stroke={11} color={MACRO_COLOR.calories}
              label="kcal left" sizeClass="h-[104px] w-[104px] sm:h-[128px] sm:w-[128px]" ready={nut != null} />
            <Ring consumed={protein} target={targets.protein} size={92} stroke={9} color={MACRO_COLOR.protein}
              label="g left" sizeClass="h-[88px] w-[88px]" ready={nut != null} />
            <div className="min-w-[10rem] flex-1">
              <p className="text-body text-fg-muted tabular-nums">
                <AnimatedNumber value={consumed} ready={nut != null} className="text-title font-bold text-fg" /> / {targets.calories} kcal
              </p>
              <p className="mt-0.5 text-meta tabular-nums">
                {proteinHit
                  ? <span className="inline-flex items-center gap-1 font-medium text-success"><Check aria-hidden className="h-3.5 w-3.5" />Protein hit{proteinLeft < 0 ? ` (+${-proteinLeft}g)` : ''}</span>
                  : <span className="text-fg-muted"><strong className="font-semibold text-fg-2">{protein}g</strong> / {targets.protein}g protein · {proteinLeft}g left</span>}
              </p>
            </div>
          </div>
          {nut && nut.calories > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              {/* The gram figures carry the colour key, so the bar's own % legend is off. */}
              <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} showLegend={false} />
              {/* Each total opens a peek: the exact amount and the foods it came from. */}
              <div className="mt-2 grid grid-cols-3 justify-items-start gap-x-3 gap-y-1 text-meta tabular-nums text-fg-2">
                <MacroFigure macro="protein_g" label="protein" value={nut.protein_g} color={MACRO_COLOR.protein} meals={nut.meals} />
                <MacroFigure macro="carbs_g" label="carbs" value={nut.carbs_g} color={MACRO_COLOR.carbs} meals={nut.meals} />
                <MacroFigure macro="fat_g" label="fat" value={nut.fat_g} color={MACRO_COLOR.fat} meals={nut.meals} />
                <MacroFigure macro="fiber_g" label="fiber" value={nut.fiber_g} color={MACRO_COLOR.fiber} meals={nut.meals} />
                {nut.sugar_g > 0 && <MacroFigure macro="sugar_g" label="sugar" value={nut.sugar_g} color={MACRO_COLOR.sugar} meals={nut.meals} />}
              </div>
            </div>
          )}
        </Card>),

      water: (<Card className="!py-3">
          <WaterTracker date={date} />
        </Card>),

      history: <RecentDaysCard date={date} weightKg={coach.weightKg} />,

      // Coach — collapsible on phones so the meal slots stay reachable.
      coach: (<Card>
          <button type="button" onClick={() => setCoachOpen(o => !o)} aria-expanded={coachOpen}
            className="-my-2 flex min-h-[44px] w-full items-center gap-2.5 text-left sm:hidden">
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600"><Brain className="h-4 w-4" /></span>
            <span className="section-label flex-1">Coach</span>
            <Truncate className="text-meta tabular-nums text-fg-muted">{coachSummary}</Truncate>
            <ChevronRight aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', coachOpen && 'rotate-90')} />
          </button>
          <CardHeader title="Coach" variant="label" icon={<Brain />} className="hidden sm:flex" />
          <div className={cx(coachOpen ? 'mt-3 block' : 'hidden', 'text-body sm:mt-0 sm:block')}>
            <CoachDecisionView coach={coach} currentProtein={targets.protein}
              onApplyCalories={kcal => applyCalories(kcal, formatLocalDate(new Date()))}
              onApplyProtein={applyProtein} />
          </div>
        </Card>),


      fits: <FitsLeftCard date={date} goal={targets} eaten={nut} fatFloorG={coach.fatFloorG} />,

      guess: <QuickGuessCard date={date} />,

      meals: (
      <div className="grid min-w-0 grid-cols-1 content-start gap-3 stagger-in sm:gap-4">
        {SLOTS.map(({ slot, label, icon }) => {
          const meals = bySlot.get(slot) ?? []
          const kcal = meals.filter(m => m.source === 'log').reduce((a, m) => a + m.calories, 0)
          return (
            <Card key={slot} padded={false} className="@container overflow-hidden">
              <header className="flex items-center gap-2 border-b border-line py-1 pl-4 pr-2">
                <span aria-hidden className="text-base leading-none">{icon}</span>
                <h3 className="flex-1 text-ui font-semibold text-fg">{label}</h3>
                {kcal > 0 && <span className="text-meta tabular-nums text-fg-muted">{kcal} kcal</span>}
                <button type="button" onClick={() => openLog(slot)}
                  className="btn-ghost btn-sm gap-1 !px-2.5 text-accent-600">
                  <Plus aria-hidden className="h-4 w-4" />Log
                </button>
              </header>
              {meals.length > 0 ? (
                <ul className="divide-y divide-line">
                  {/* Column headings for the wide layout's aligned numbers. */}
                  <li aria-hidden className={cx(MACRO_GRID, 'pl-4 pr-2 py-1 text-micro font-semibold uppercase tracking-[0.06em] text-fg-faint')}>
                    <span />
                    <span className="text-right">Amount</span>
                    <span className="text-right">kcal</span>
                    <span className="text-right">Protein</span>
                    <span className="text-right">Carbs</span>
                    <span className="text-right">Fat</span>
                    <span className="text-right">Fiber</span>
                    <span /><span />
                  </li>
                  {groupDayMeals(meals).map(row => row.kind === 'group' ? dishLine(row, slot) : mealLine(row.meal))}
                </ul>
              ) : (
                <div className="flex items-center pr-2">
                  <button type="button" onClick={() => openLog(slot)}
                    className="flex min-h-[44px] min-w-0 flex-1 items-center whitespace-nowrap px-4 text-left text-body text-fg-faint transition-colors hover:text-accent-600">
                    {/* Short labels in a narrow card so the three actions keep one row. */}
                    Add<span className="hidden @[26rem]:inline">&nbsp;something</span>
                  </button>
                  {usualForSlot(recent, slot).length > 0 && (
                    <button type="button" disabled={addEntries.isPending}
                      onClick={() => addEntries.mutate(usualForSlot(recent, slot).map(r => recentToEntry(r, date, slot)))}
                      title={usualForSlot(recent, slot).map(r => r.title).join(', ')}
                      aria-label={`Log usual (${usualForSlot(recent, slot).length})`}
                      className="btn-ghost btn-sm shrink-0 !px-2.5 text-accent-600">
                      <span className="@[26rem]:hidden">Usual ({usualForSlot(recent, slot).length})</span><span className="hidden @[26rem]:inline">Log usual ({usualForSlot(recent, slot).length})</span>
                    </button>
                  )}
                  <button type="button" disabled={copyYesterday.isPending}
                    onClick={() => copyYesterday.mutate({ date, filledSlots: new Set(bySlot.keys()), slots: [slot] })}
                    className="btn-ghost btn-sm shrink-0 gap-1 !px-2.5 text-fg-muted" title={`Log the same ${label.toLowerCase()} as the day before`}
                    aria-label={`Same ${label.toLowerCase()} as yesterday`}>
                    <Copy aria-hidden className="h-3.5 w-3.5" /><span className="@[26rem]:hidden">Yesterday</span><span className="hidden @[26rem]:inline">Same as yesterday</span>
                  </button>
                </div>
              )}
            </Card>
          )
        })}
      </div>),
    }} />
  )
}
