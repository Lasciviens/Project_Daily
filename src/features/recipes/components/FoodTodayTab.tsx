import { useState, type ReactNode } from 'react'
import { Brain, Check, ChevronRight, Plus, Settings2, X } from 'lucide-react'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { useNutritionCoach } from '../../daily/hooks/useNutritionCoach'
import { useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useDeleteQuickMeal } from '../../daily/hooks/useQuickMeals'
import { useEatPlannedEntry } from '../hooks/useMealPlan'
import { MacroBar } from './MacroBar'
import { WaterTracker } from '../../daily/components/summary/WaterTracker'
import { Card, CardHeader, IconButton, TonePill, cx } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { MACRO_COLOR } from '../macroColors'
import type { MealSlot } from '../types'
import { groupDayMeals, type DayMeal, type MealGroupRow } from '../../daily/api/dayNutritionApi'

// The wide meal-row grid: name · amount · kcal · protein · carbs · fat · fiber · ✓ · ✕.
// Shared by the rows and their column-heading row so the two always line up.
const MACRO_GRID = 'hidden items-center gap-x-2 @[40rem]:grid @[40rem]:grid-cols-[minmax(0,1fr)_3.5rem_3rem_3.25rem_3rem_3rem_3rem_2.75rem_2.75rem]'

// `DayMeal.title` bakes the amount into the string ("Chicken · 150g"); the
// desktop grid wants name and amount in separate aligned columns. Only a tail
// that starts with a digit is a quantity — a food name that itself contains
// " · " must not be chopped in two.
function splitTitleQty(title: string): { name: string; qty: string | null } {
  const idx = title.lastIndexOf(' · ')
  if (idx === -1) return { name: title, qty: null }
  const qty = title.slice(idx + 3)
  if (!/^\d/.test(qty)) return { name: title, qty: null }
  return { name: title.slice(0, idx), qty }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Food · Today — the full nutrition surface. Summary + water + coach on the
//  left, meal slots on the right (xl+). A check on a PLANNED row confirms it as
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
function Ring({ consumed, target, size, stroke, color, label, sizeClass }: {
  consumed: number; target: number; size: number; stroke: number; color: string; label: string; sizeClass: string
}) {
  const R = (size - stroke) / 2 - 1
  const C = 2 * Math.PI * R
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0
  const remaining = Math.max(Math.round(target - consumed), 0)
  const over = consumed > target
  const c = size / 2
  return (
    <div className={cx('relative shrink-0', sizeClass)}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden>
        <circle cx={c} cy={c} r={R} fill="none" strokeWidth={stroke} style={{ stroke: 'rgb(var(--cream-100))' }} />
        <circle cx={c} cy={c} r={R} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          style={{ stroke: over ? 'rgb(var(--danger))' : color }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cx('font-bold leading-none tabular-nums text-fg', size > 100 ? 'text-title sm:text-kpi' : 'text-ui sm:text-lead')}>{remaining}</span>
        <span className={cx('mt-0.5 text-micro leading-none', over ? 'text-danger' : 'text-fg-muted')}>{over ? 'over' : label}</span>
      </div>
    </div>
  )
}

function MacroFigure({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

const PLANNED_PILL = <TonePill tone="neutral" className="shrink-0">Planned</TonePill>

export function FoodTodayTab({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update } = useDayTargets()
  const modal = useEntityModal()
  const coach = useNutritionCoach(date, targets)
  const delLog  = useDeleteFoodLogEntry()
  const delMeal = useDeleteQuickMeal()
  const eatPlan = useEatPlannedEntry()
  const [coachOpen, setCoachOpen] = useState(false)   // phone-only collapse
  // "As meal" groups expanded to their individual items (collapsed by default).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Goals live in the shared `day-targets` popup (draft → Save). The Coach's
  // "Apply" buttons stay one deliberate tap that writes immediately.
  const openGoals = () => modal.open({ kind: 'day-targets', date })
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
  const coachSummary =
    coach.weightKg == null ? 'Set up'
    : coach.calorieAdvice ? `${coach.calorieAdvice.delta > 0 ? '+' : ''}${coach.calorieAdvice.delta} kcal suggested`
    : coach.proteinForGoal != null && coach.proteinForGoal !== targets.protein ? `Suggest ${coach.proteinForGoal}g protein`
    : 'On track'

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []; arr.push(m); bySlot.set(m.meal_slot, arr)
  }

  // One logged/planned item, standalone or indented inside an expanded group.
  // Two markups (stacked phone vs aligned desktop grid) because the column
  // count would otherwise change under one fixed set of children.
  function mealLine(meal: DayMeal, indent: boolean) {
    const planned = meal.source === 'plan'
    const { name, qty } = splitTitleQty(meal.title)
    const onOpen = () => {
      if (planned) {
        if (meal.planEntry) modal.open({ kind: 'meal-plan', date, slot: meal.planEntry.meal_slot, entryId: meal.planEntry.id })
      } else {
        modal.open({ kind: 'food-log-edit', entryId: meal.id, date })
      }
    }
    const onDelete = () => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)
    const macroLine = [
      qty,
      meal.calories > 0 && `${meal.calories} kcal`,
      meal.protein_g > 0 && `${meal.protein_g}g protein`,
      meal.carbs_g > 0 && `${meal.carbs_g}g carbs`,
      meal.fat_g > 0 && `${meal.fat_g}g fat`,
      meal.fiber_g > 0 && `${meal.fiber_g}g fiber`,
    ].filter(Boolean).join(' · ')
    const nameBtn = (
      <button type="button" onClick={onOpen} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-accent-600">
        <span className={cx('truncate', planned ? 'italic text-fg-muted' : 'text-fg')}>{name}</span>
        {planned && PLANNED_PILL}
      </button>
    )
    const eatBtn = planned && meal.planEntry ? (
      <IconButton label={`Mark ${name} eaten`} onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
        className="text-success disabled:opacity-50"><Check /></IconButton>
    ) : null
    const delBtn = (
      <IconButton label={`Remove ${name}`} onClick={onDelete} className="text-fg-faint hover:!text-danger"><X /></IconButton>
    )
    const num = 'text-meta tabular-nums text-right text-fg-muted'
    return (
      <li key={meal.id} className={indent ? 'bg-surface-2/60' : undefined}>
        {/* Narrow card: name + actions, macro line underneath */}
        <div className="@[40rem]:hidden">
          <div className={cx('flex items-center gap-1 text-body', indent ? 'pl-9 pr-2' : 'pl-4 pr-2')}>
            {nameBtn}{eatBtn}{delBtn}
          </div>
          {macroLine && <p className={cx('-mt-1.5 pb-2 text-meta tabular-nums text-fg-muted', indent ? 'pl-9 pr-4' : 'px-4')}>{macroLine}</p>}
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
          {eatBtn ?? <span />}
          {delBtn}
        </div>
      </li>
    )
  }

  // Several individually logged items collapsed into ONE row; tap to expand.
  function groupHeaderLine(group: MealGroupRow) {
    const expanded = expandedGroups.has(group.groupId)
    const totals = [
      `${group.calories} kcal`,
      group.protein_g > 0 && `${group.protein_g}g protein`,
      group.carbs_g > 0 && `${group.carbs_g}g carbs`,
      group.fat_g > 0 && `${group.fat_g}g fat`,
      group.fiber_g > 0 && `${group.fiber_g}g fiber`,
    ].filter(Boolean).join(' · ')
    return (
      <li key={group.groupId}>
        <button type="button" onClick={() => toggleGroup(group.groupId)} aria-expanded={expanded}
          className="flex min-h-[44px] w-full items-center gap-2 px-4 py-1 text-left text-body transition-colors hover:bg-surface-hover">
          <ChevronRight aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', expanded && 'rotate-90')} />
          <span className="min-w-0 flex-1 truncate text-fg">{group.title}</span>
          <span className="count-badge shrink-0">{group.items.length} items</span>
          <span className="hidden shrink-0 text-meta tabular-nums text-fg-muted @[40rem]:inline">{totals}</span>
          <span className="shrink-0 text-meta tabular-nums text-fg-muted @[40rem]:hidden">{group.calories} kcal</span>
        </button>
        {!expanded && <p className="-mt-1 pb-2 pl-10 pr-4 text-meta tabular-nums text-fg-muted @[40rem]:hidden">{totals}</p>}
        {expanded && (
          <ul className="divide-y divide-line border-t border-line">
            {group.items.map(m => mealLine(m, true))}
          </ul>
        )}
      </li>
    )
  }

  const coachAction = 'flex min-h-[44px] items-center justify-between gap-2 rounded-row border border-line bg-surface px-3 py-1.5 text-left transition-colors hover:bg-surface-hover'

  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:gap-4 justify-start xl:grid-cols-[minmax(0,30rem)_minmax(0,42rem)]">
      {/* Left: summary, water, coach */}
      <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
        <Card>
          <CardHeader title="Nutrition" variant="label"
            action={<IconButton label="Nutrition goals" onClick={openGoals} className="-my-2 -mr-2"><Settings2 /></IconButton>} />
          <div className="flex flex-wrap items-center gap-4 sm:gap-5">
            <Ring consumed={consumed} target={targets.calories} size={134} stroke={11} color={MACRO_COLOR.calories}
              label="kcal left" sizeClass="h-[104px] w-[104px] sm:h-[128px] sm:w-[128px]" />
            <Ring consumed={protein} target={targets.protein} size={92} stroke={9} color={MACRO_COLOR.protein}
              label="g left" sizeClass="h-[88px] w-[88px]" />
            <div className="min-w-[10rem] flex-1">
              <p className="text-body text-fg-muted tabular-nums">
                <strong className="text-title font-bold text-fg">{consumed}</strong> / {targets.calories} kcal
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
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta tabular-nums text-fg-2">
                <MacroFigure color={MACRO_COLOR.protein}>{nut.protein_g}g protein</MacroFigure>
                <MacroFigure color={MACRO_COLOR.carbs}>{nut.carbs_g}g carbs</MacroFigure>
                <MacroFigure color={MACRO_COLOR.fat}>{nut.fat_g}g fat</MacroFigure>
                <MacroFigure color={MACRO_COLOR.fiber}>{nut.fiber_g}g fiber</MacroFigure>
                {nut.sugar_g > 0 && <span className="text-fg-muted">{nut.sugar_g}g sugar</span>}
              </div>
            </div>
          )}
        </Card>

        <Card className="!py-3">
          <WaterTracker date={date} />
        </Card>

        {/* Coach — collapsible on phones so the meal slots stay reachable. */}
        <Card>
          <button type="button" onClick={() => setCoachOpen(o => !o)} aria-expanded={coachOpen}
            className="-my-2 flex min-h-[44px] w-full items-center gap-2.5 text-left sm:hidden">
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600"><Brain className="h-4 w-4" /></span>
            <span className="section-label flex-1">Coach</span>
            <span className="truncate text-meta tabular-nums text-fg-muted">{coachSummary}</span>
            <ChevronRight aria-hidden className={cx('h-4 w-4 shrink-0 text-fg-faint transition-transform', coachOpen && 'rotate-90')} />
          </button>
          <CardHeader title="Coach" variant="label" icon={<Brain />} className="hidden sm:flex" />
          <div className={cx(coachOpen ? 'mt-3 flex' : 'hidden', 'flex-col gap-2 text-body sm:mt-0 sm:flex')}>
            {coach.weightKg == null ? (
              <p className="text-fg-muted">Add a bodyweight in <strong className="font-semibold text-fg-2">Training → Body</strong> (or sync Apple Health) to unlock protein and calorie coaching from your real weight trend.</p>
            ) : (
              <>
                {coach.calorieAdvice ? (
                  <button type="button" className={coachAction}
                    onClick={() => applyCalories(Math.max(coach.calorieFloor, targets.calories + coach.calorieAdvice!.delta), formatLocalDate(new Date()))}>
                    <span className="text-fg-2"><strong className="font-semibold text-fg tabular-nums">{coach.calorieAdvice.delta > 0 ? '+' : ''}{coach.calorieAdvice.delta} kcal</strong><span className="text-fg-muted"> · {coach.calorieAdvice.reason}</span></span>
                    <span className="shrink-0 font-semibold text-accent-600">Apply</span>
                  </button>
                ) : coach.onTrack ? (
                  <p className="flex items-center gap-1.5 text-success"><Check aria-hidden className="h-4 w-4 shrink-0" />{coach.onTrack}</p>
                ) : coach.atFloor ? (
                  <p className="text-fg-muted">At your calorie floor (~{coach.calorieFloor}) but not losing — take a diet break rather than cutting lower.</p>
                ) : !coach.consistent ? (
                  <p className="text-fg-muted">Logged {coach.loggedDays7}/7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock the calorie nudge.</p>
                ) : !coach.weighInsOk ? (
                  <p className="text-fg-muted">Weigh in more often ({coach.weighIns} readings) — a couple of weeks lets me read your trend.</p>
                ) : coach.inCooldown ? (
                  <p className="text-fg-muted">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
                ) : null}
                {coach.proteinForGoal != null && coach.proteinForGoal !== targets.protein ? (
                  <button type="button" className={coachAction} onClick={() => applyProtein(coach.proteinForGoal!)}>
                    <span className="text-fg-2">Suggested <strong className="font-semibold text-fg tabular-nums">{coach.proteinForGoal}g</strong> protein <span className="text-fg-muted">· {(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg × {Math.round(coach.weightKg)}kg</span></span>
                    <span className="shrink-0 font-semibold text-accent-600">Apply</span>
                  </button>
                ) : coach.proteinForGoal != null ? (
                  <p className="flex items-center gap-1.5 text-success"><Check aria-hidden className="h-4 w-4 shrink-0" />Protein target on point ({(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg)</p>
                ) : null}
                {coach.proteinPerMealG != null && (
                  <p className="text-meta text-fg-muted">About {coach.proteinPerMealG}g protein per meal spreads it best{coach.fatFloorG != null ? ` · keep fat ≥ ~${coach.fatFloorG}g/day on a cut` : ''}</p>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Right: meal slots */}
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
                  {groupDayMeals(meals).map(row => row.kind === 'group' ? groupHeaderLine(row) : mealLine(row.meal, false))}
                </ul>
              ) : (
                <button type="button" onClick={() => openLog(slot)}
                  className="flex min-h-[44px] w-full items-center px-4 text-left text-body text-fg-faint transition-colors hover:text-accent-600">
                  Add something
                </button>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
