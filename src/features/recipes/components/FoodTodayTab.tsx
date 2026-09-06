import { useState } from 'react'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useDayTargets, useDayTargetProfiles, type NutritionGoal, type DayTargets } from '../../daily/hooks/useDayTargets'
import { useNutritionCoach } from '../../daily/hooks/useNutritionCoach'
import { useDeleteFoodLogEntry } from '../hooks/useFoodLog'
import { useDeleteQuickMeal } from '../../daily/hooks/useQuickMeals'
import { useEatPlannedEntry } from '../hooks/useMealPlan'
import { MacroBar } from './MacroBar'
import { WaterTracker } from '../../daily/components/summary/WaterTracker'
import { FoodLogModal } from './FoodLogModal'
import { EditFoodLogModal } from './EditFoodLogModal'
import { AssignMealModal } from './AssignMealModal'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import type { MealSlot, MealPlanEntry } from '../types'
import { groupDayMeals, type DayMeal, type MealGroupRow } from '../../daily/api/dayNutritionApi'

// `DayMeal.title` bakes the amount straight into the string ("Chicken ·
// 150g") — fine for a single flowing line, but the desktop grid wants the
// name and the amount in two SEPARATE aligned columns ("Gramaj yapışık
// olmasın" — the amount shouldn't read glued to the name). Split on the
// same " · " separator both `unifiedToMeal` branches already use, but only
// treat the tail as a quantity if it looks like one (starts with a digit) —
// a food name that legitimately contains " · " itself must not get chopped
// into two garbled halves.
function splitTitleQty(title: string): { name: string; qty: string | null } {
  const idx = title.lastIndexOf(' · ')
  if (idx === -1) return { name: title, qty: null }
  const qty = title.slice(idx + 3)
  if (!/^\d/.test(qty)) return { name: title, qty: null }
  return { name: title.slice(0, idx), qty }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Food · Today — the FULL-SIZE nutrition surface. Two columns on wide screens
//  (summary + coach left · meal slots right, so the right isn't empty). Small
//  calorie + protein rings, macro chips (fiber inline w/ a green dot next to
//  fat), an inline Goals editor, and — the key flow — a ✓ on a PLANNED row
//  confirms it as EATEN so it starts counting toward the day.
// ─────────────────────────────────────────────────────────────────────────────

const SLOTS: { slot: MealSlot; label: string; icon: string }[] = [
  { slot: 'breakfast',  label: 'Breakfast',  icon: '🌅' },
  { slot: 'lunch',      label: 'Lunch',      icon: '☀️' },
  { slot: 'dinner',     label: 'Dinner',     icon: '🌙' },
  { slot: 'snack',      label: 'Snack',      icon: '🍎' },
  { slot: 'supplement', label: 'Supplement', icon: '💊' },
]
const GOAL_LABEL: Record<NutritionGoal, string> = { maintain: 'Maintain', cut: 'Cut', gain: 'Gain' }

// `size` is the SVG coordinate/geometry basis; `sizeClass` sets the DISPLAYED
// box (responsive so the ring can shrink on a phone) — the viewBox scales the
// stroke proportionally, so geometry stays correct at any rendered size.
function Ring({ consumed, target, size, stroke, color, label, sizeClass }: {
  consumed: number; target: number; size: number; stroke: number; color: string; label: string; sizeClass: string
}) {
  const R = (size - stroke) / 2 - 1
  const C = 2 * Math.PI * R
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0
  const remaining = Math.max(Math.round(target - consumed), 0)
  const over = consumed > target
  const cx = size / 2
  return (
    <div className={`relative shrink-0 ${sizeClass}`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={cx} cy={cx} r={R} fill="none" stroke="rgb(var(--ink-100))" strokeWidth={stroke} />
        <circle cx={cx} cy={cx} r={R} fill="none" stroke={over ? '#f87171' : color}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold text-ink-900 leading-none tabular-nums ${size > 100 ? 'text-xl sm:text-2xl' : 'text-sm sm:text-base'}`}>{remaining}</span>
        <span className="text-[9px] text-ink-400 mt-0.5">{over ? 'over' : label}</span>
      </div>
    </div>
  )
}

// −/+ stepper for a goal number (same feel as the Daily card's).
function GoalStepper({ value, step, suffix, onChange }: { value: number; step: number; suffix: string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, v))
  const btn = 'w-11 h-11 min-h-[44px] rounded-lg border border-ink-200 text-ink-600 hover:border-accent-300 flex items-center justify-center leading-none'
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => set(value - step)} className={btn}>−</button>
      <div className="relative">
        <input type="number" value={value} min={0} step={step} onChange={e => set(Number(e.target.value) || 0)}
          // Hide the browser's own up/down spinner — it would sit right on
          // top of the −/+ buttons already flanking this field, a second,
          // redundant increment control.
          className="w-20 min-h-[44px] text-sm text-center pr-8 tabular-nums border border-ink-200 rounded-lg bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-400 pointer-events-none">{suffix}</span>
      </div>
      <button type="button" onClick={() => set(value + step)} className={btn}>+</button>
    </div>
  )
}

export function FoodTodayTab({ date }: { date: string }) {
  const { data: nut } = useDayNutrition(date)
  const { targets, update, isSaving } = useDayTargets()
  const profiles = useDayTargetProfiles()
  const coach = useNutritionCoach(date, targets)
  const delLog  = useDeleteFoodLogEntry()
  const delMeal = useDeleteQuickMeal()
  const eatPlan = useEatPlannedEntry()
  const [logSlot, setLogSlot] = useState<MealSlot | null>(null)
  const [editMeal, setEditMeal] = useState<DayMeal | null>(null)
  const [planMeal, setPlanMeal] = useState<MealPlanEntry | null>(null)
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)   // mobile-only collapse

  // Editing the Goals panel is a DRAFT — nothing writes until "Save" is
  // tapped (see the identical pattern + rationale in NutritionCard.tsx).
  const [draft, setDraft] = useState<DayTargets>(targets)
  const [goalsWasOpen, setGoalsWasOpen] = useState(goalsOpen)
  if (goalsOpen !== goalsWasOpen) {
    setGoalsWasOpen(goalsOpen)
    if (goalsOpen) setDraft(targets)
  }
  function selectGoal(g: NutritionGoal) {
    const profile = profiles[g]
    setDraft(d => (profile ? { ...d, goal: g, ...profile } : { ...d, goal: g }))
  }
  // Coach "Apply" buttons write immediately while the panel is closed
  // (unchanged, one deliberate tap); while it's open they feed the draft so
  // a pending manual edit and an unrelated coach suggestion can't clobber
  // each other.
  function applyProtein(g: number) {
    if (goalsOpen) setDraft(d => ({ ...d, protein: g })); else update({ protein: g })
  }
  function applyCalories(kcal: number, adjustDate: string) {
    if (goalsOpen) setDraft(d => ({ ...d, calories: kcal, lastCalorieAdjust: adjustDate }))
    else update({ calories: kcal, lastCalorieAdjust: adjustDate })
  }
  // Which "As meal" groups are expanded to their individual items — collapsed
  // (just the compact summary row) by default for every group.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  function toggleGroup(id: string) {
    setExpandedGroups(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const consumed = nut?.calories ?? 0
  const protein  = nut?.protein_g ?? 0
  const proteinLeft = Math.round(targets.protein - protein)
  const proteinHit  = targets.protein > 0 && proteinLeft <= 0

  // One-line status shown in the collapsed (mobile) Coach header.
  const coachSummary =
    coach.weightKg == null ? 'Set up →'
    : coach.calorieAdvice ? `${coach.calorieAdvice.delta > 0 ? '+' : ''}${coach.calorieAdvice.delta} kcal suggested`
    : coach.proteinForGoal != null && coach.proteinForGoal !== targets.protein ? `Suggest ${coach.proteinForGoal}g protein`
    : coach.onTrack ? '✓ On track'
    : '✓ Looking good'

  const bySlot = new Map<string, DayMeal[]>()
  for (const m of nut?.meals ?? []) {
    const arr = bySlot.get(m.meal_slot) ?? []; arr.push(m); bySlot.set(m.meal_slot, arr)
  }

  // One row for a single logged/planned item — used both standalone and as
  // an indented item inside an expanded "As meal" group. Two markups
  // (mobile stacked vs. desktop grid) rather than one responsive grid whose
  // column COUNT would need to change per breakpoint out from under the
  // same fixed set of children.
  function mealLine(meal: DayMeal, indent: boolean) {
    const planned = meal.source === 'plan'
    const { name, qty } = splitTitleQty(meal.title)
    const onOpen = () => planned ? setPlanMeal(meal.planEntry ?? null) : setEditMeal(meal)
    const onDelete = () => meal.source === 'log' ? delLog.mutate({ id: meal.id, date }) : delMeal.mutate(meal.id)
    const macroLine = [
      qty,
      meal.calories > 0 && `${meal.calories} kcal`,
      meal.protein_g > 0 && `${meal.protein_g}p`,
      meal.carbs_g > 0 && `${meal.carbs_g}c`,
      meal.fat_g > 0 && `${meal.fat_g}f`,
      meal.fiber_g > 0 && `${meal.fiber_g}fib`,
    ].filter(Boolean).join(' · ')
    return (
      <li key={meal.id} className={indent ? 'bg-cream-100/40' : ''}>
        {/* Mobile — name+kcal+actions, then a small macro line underneath */}
        <div className="sm:hidden">
          <div className={`flex items-center gap-1.5 min-h-[44px] py-1 text-sm ${indent ? 'pl-9 pr-4' : 'px-4'}`}>
            <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left hover:text-accent-700 transition-colors flex items-center gap-1.5">
              <span className={`truncate ${planned ? 'text-ink-400 italic' : 'text-ink-800'}`}>{name}</span>
              {planned && <span className="text-[9px] uppercase tracking-wide text-ink-500 border border-ink-200 rounded px-1 shrink-0">planned</span>}
            </button>
            {planned && meal.planEntry && (
              <button onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
                aria-label={`Mark ${name} eaten`} title="I ate this — count it"
                className="press-feedback min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-green-600 hover:bg-green-50 shrink-0 disabled:opacity-50">✓</button>
            )}
            <button onClick={onDelete} aria-label={`Remove ${name}`}
              className="press-feedback min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-red-500 shrink-0">✕</button>
          </div>
          {macroLine && <p className={`text-[11px] text-ink-400 tabular-nums pb-1 -mt-1 ${indent ? 'pl-9' : 'px-4'}`}>{macroLine}</p>}
        </div>

        {/* Desktop — every macro in its own aligned column, never crammed
            into the name (the reported "gramaj yapışık" complaint). */}
        <div className={`hidden sm:grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_2.5rem_2.5rem_2.5rem_2.5rem_auto_auto] items-center gap-x-2 min-h-[44px] py-1 text-sm ${indent ? 'pl-9 pr-4' : 'px-4'}`}>
          <button type="button" onClick={onOpen} className="min-w-0 text-left hover:text-accent-700 transition-colors flex items-center gap-1.5">
            <span className={`truncate ${planned ? 'text-ink-400 italic' : 'text-ink-800'}`}>{name}</span>
            {planned && <span className="text-[9px] uppercase tracking-wide text-ink-500 border border-ink-200 rounded px-1 shrink-0">planned</span>}
          </button>
          <span className="text-[11px] text-ink-400 tabular-nums text-right">{qty ?? ''}</span>
          <span className={`text-xs tabular-nums text-right ${planned ? 'text-ink-400' : 'text-ink-500'}`}>{meal.calories > 0 ? meal.calories : ''}</span>
          <span className="text-[11px] text-ink-400 tabular-nums text-right">{meal.protein_g > 0 ? `${meal.protein_g}p` : ''}</span>
          <span className="text-[11px] text-ink-400 tabular-nums text-right">{meal.carbs_g > 0 ? `${meal.carbs_g}c` : ''}</span>
          <span className="text-[11px] text-ink-400 tabular-nums text-right">{meal.fat_g > 0 ? `${meal.fat_g}f` : ''}</span>
          <span className="text-[11px] text-ink-400 tabular-nums text-right">{meal.fiber_g > 0 ? `${meal.fiber_g}fib` : ''}</span>
          {planned && meal.planEntry ? (
            <button onClick={() => eatPlan.mutate(meal.planEntry!)} disabled={eatPlan.isPending}
              aria-label={`Mark ${name} eaten`} title="I ate this — count it"
              className="press-feedback min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-green-600 hover:bg-green-50 shrink-0 disabled:opacity-50">✓</button>
          ) : <span />}
          <button onClick={onDelete} aria-label={`Remove ${name}`}
            className="press-feedback min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-red-500 shrink-0">✕</button>
        </div>
      </li>
    )
  }

  // A compact "As meal" group header — several individually-logged items
  // collapsed into ONE row; tapping it expands to each item's own mealLine.
  function groupHeaderLine(group: MealGroupRow) {
    const expanded = expandedGroups.has(group.groupId)
    const totals = [
      `${group.calories} kcal`,
      group.protein_g > 0 && `${group.protein_g}p`,
      group.carbs_g > 0 && `${group.carbs_g}c`,
      group.fat_g > 0 && `${group.fat_g}f`,
      group.fiber_g > 0 && `${group.fiber_g}fib`,
    ].filter(Boolean).join(' · ')
    return (
      <li key={group.groupId}>
        <button type="button" onClick={() => toggleGroup(group.groupId)}
          className="w-full flex items-center gap-1.5 min-h-[44px] px-4 py-1 text-sm hover:bg-cream-100/60 transition-colors text-left">
          <span className={`inline-block shrink-0 text-ink-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
          <span className="flex-1 min-w-0 truncate text-ink-800">{group.title}</span>
          <span className="text-[9px] uppercase tracking-wide text-ink-400 border border-ink-200 rounded px-1 shrink-0">{group.items.length} items</span>
          <span className="hidden sm:inline text-xs text-ink-500 tabular-nums shrink-0">{totals}</span>
          <span className="sm:hidden text-xs text-ink-500 tabular-nums shrink-0">{group.calories} kcal</span>
        </button>
        {!expanded && (
          <p className="sm:hidden text-[11px] text-ink-400 tabular-nums px-4 pl-9 pb-1 -mt-1">{totals}</p>
        )}
        {expanded && (
          <ul className="divide-y divide-ink-50 border-t border-ink-50">
            {group.items.map(m => mealLine(m, true))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Day navigation now lives in the header banner (RecipesPage). */}

      {/* Two columns on xl+: summary+goals+coach (left, wider) · meal slots
          (right, narrower). Nutrition & Goals stack same-width in the left col. */}
      <div className="flex flex-col xl:flex-row xl:items-start gap-4">
        <div className="flex flex-col gap-4 w-full xl:w-[34rem] xl:shrink-0">
          {/* Hero — calorie + protein rings + macro chips */}
          <div className="rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden relative">
            <div className="h-1 bg-accent-500" />
            {/* ⚙ Goals — bottom-right corner of the nutrition widget. */}
            <button onClick={() => setGoalsOpen(o => !o)} title="Goals" aria-label="Goals"
              className={`press-feedback absolute bottom-2 right-2 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-base transition-colors ${goalsOpen ? 'text-accent-700 bg-accent-50' : 'text-ink-400 hover:text-accent-600 hover:bg-cream-100/90 bg-cream-50/70'}`}>⚙</button>
            <div className="p-4 sm:p-6 flex items-center gap-4 sm:gap-5 flex-wrap">
              <Ring consumed={consumed} target={targets.calories} size={134} stroke={11} color="rgb(var(--accent-500))" label="kcal left" sizeClass="w-[108px] h-[108px] sm:w-[134px] sm:h-[134px]" />
              {/* Small, tasteful protein ring — "kalan protein" as a graphic. */}
              <Ring consumed={protein} target={targets.protein} size={92} stroke={9} color="#60a5fa" label="prot left" sizeClass="w-[76px] h-[76px] sm:w-[92px] sm:h-[92px]" />
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm text-ink-700">
                  <strong className="text-lg text-ink-900 tabular-nums">{consumed}</strong>
                  <span className="text-ink-400"> / {targets.calories} kcal</span>
                </p>
                <p className="text-[11px] mt-0.5 tabular-nums">
                  {proteinHit
                    ? <span className="text-green-600 font-medium">✓ Protein hit{proteinLeft < 0 ? ` (+${-proteinLeft}g)` : ''}</span>
                    : <span className="text-ink-500"><strong className="text-ink-700">{protein}g</strong> / {targets.protein}g protein · {proteinLeft}g left</span>}
                </p>
                {nut && nut.calories > 0 && (
                  <div className="mt-2.5">
                    {/* ONE macro row. The bar's own legend printed the same split
                        as percentages directly above these grams (~40px of pure
                        duplication on a phone), so it's suppressed here and the
                        colour dots move onto the gram figures. Full macro names,
                        never P/C/F. `pr-12` clears the ⚙ Goals button's 44px box. */}
                    <MacroBar protein={nut.protein_g} carbs={nut.carbs_g} fat={nut.fat_g} showLegend={false} />
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 pr-12 text-[11px] tabular-nums text-ink-600">
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 shrink-0 rounded-full bg-blue-400" />{nut.protein_g}g protein</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 shrink-0 rounded-full bg-orange-400" />{nut.carbs_g}g carbs</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 shrink-0 rounded-full bg-rose-400" />{nut.fat_g}g fat</span>
                      <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 shrink-0 rounded-full bg-green-500" />{nut.fiber_g}g fiber</span>
                      {nut.sugar_g > 0 && <span className="text-ink-500">{nut.sugar_g}g sugar</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Hydration — its own card under the nutrition hero. */}
          <div className="rounded-2xl border border-ink-200 bg-cream-50 px-4 py-3">
            <WaterTracker date={date} />
          </div>

          {/* Goals editor — under the nutrition widget, same width (user
              request). Set targets by hand + apply coach suggestions. */}
          {goalsOpen && (
            <div className="rounded-2xl border border-ink-200 bg-cream-50 p-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Goal</span>
                <div className="flex gap-1">
                  {(['maintain', 'cut', 'gain'] as NutritionGoal[]).map(g => (
                    <button key={g} onClick={() => selectGoal(g)}
                      className={`text-[11px] px-2.5 min-h-[44px] rounded-full border transition-colors ${
                        draft.goal === g ? 'bg-accent-500 border-accent-500 text-white font-semibold' : 'border-ink-200 text-ink-600 hover:border-accent-300'
                      }`}>{GOAL_LABEL[g]}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Calories</span>
                <GoalStepper value={draft.calories} step={50} suffix="kcal" onChange={v => setDraft(d => ({ ...d, calories: v }))} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Protein</span>
                <GoalStepper value={draft.protein} step={10} suffix="g" onChange={v => setDraft(d => ({ ...d, protein: v }))} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Water</span>
                <GoalStepper value={draft.water} step={250} suffix="ml" onChange={v => setDraft(d => ({ ...d, water: v }))} />
              </div>
              <p className="text-[11px] text-ink-400 leading-relaxed">
                Each goal (Cut/Maintain/Gain) keeps its own saved numbers — switch goals above to recall them, adjust, then tap Save.
                The 🧠 Coach suggests a protein target from your bodyweight
                ({coach.weightKg ? `~${coach.proteinForGoal}g for ${draft.goal}` : 'add a bodyweight to enable'}) and nudges
                calories from your 4-week weight trend — apply those from the Coach card below. Fiber goal ≈ 14g per 1000 kcal.
              </p>
              <div className="flex items-center justify-end gap-1.5">
                <button onClick={() => setGoalsOpen(false)}
                  className="text-[11px] font-medium text-ink-500 hover:text-ink-800 min-h-[44px] px-2 rounded transition-colors">
                  Cancel
                </button>
                <button onClick={() => { update(draft); setGoalsOpen(false) }} disabled={isSaving}
                  className="text-[11px] font-semibold text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-50 min-h-[44px] px-3 rounded-lg transition-colors">
                  {isSaving ? 'Saving…' : '💾 Save'}
                </button>
              </div>
            </div>
          )}

          {/* Coach — always visible; collapsible on mobile (summary + expand)
              so the meal slots below stay reachable. Expanded by default on sm+. */}
          <div className="rounded-2xl border border-accent-200 bg-accent-50/40 px-4 py-2.5 sm:py-3 flex flex-col gap-1.5 text-xs">
            <button type="button" onClick={() => setCoachOpen(o => !o)}
              className="sm:hidden flex items-center justify-between gap-2 min-h-[44px] -my-1 text-left">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-accent-700">🧠 Coach</span>
              <span className="flex items-center gap-1.5 text-ink-500 tabular-nums">
                <span className="truncate max-w-[11rem]">{coachSummary}</span>
                <span className="text-ink-400">{coachOpen ? '▴' : '▾'}</span>
              </span>
            </button>
            <p className="hidden sm:block text-[11px] font-semibold uppercase tracking-wide text-accent-700">🧠 Coach</p>
            <div className={`${coachOpen ? 'flex' : 'hidden'} sm:flex flex-col gap-1.5`}>
            {coach.weightKg == null ? (
              <p className="text-ink-500">Add a bodyweight in <strong className="text-ink-700">Training → Body</strong> (or sync Apple Health) to unlock protein &amp; calorie coaching from your real weight trend.</p>
            ) : (
              <>
                {coach.calorieAdvice ? (
                  <button
                    onClick={() => applyCalories(Math.max(coach.calorieFloor, (goalsOpen ? draft.calories : targets.calories) + coach.calorieAdvice!.delta), formatLocalDate(new Date()))}
                    className="flex items-center justify-between gap-2 text-left rounded-lg border border-accent-200 bg-cream-50 px-2.5 py-1.5 min-h-[44px] hover:bg-accent-50 transition-colors">
                    <span className="text-ink-600"><strong className="text-accent-700">{coach.calorieAdvice.delta > 0 ? '+' : ''}{coach.calorieAdvice.delta} kcal</strong><span className="text-ink-400"> · {coach.calorieAdvice.reason}</span></span>
                    <span className="text-accent-600 font-semibold shrink-0">Apply</span>
                  </button>
                ) : coach.onTrack ? (
                  <p className="text-green-600">✓ {coach.onTrack}</p>
                ) : coach.atFloor ? (
                  <p className="text-ink-500">At your calorie floor (~{coach.calorieFloor}) but not losing — take a diet break rather than cutting lower.</p>
                ) : !coach.consistent ? (
                  <p className="text-ink-400">Logged {coach.loggedDays7}/7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock the calorie nudge.</p>
                ) : !coach.weighInsOk ? (
                  <p className="text-ink-400">Weigh in more often ({coach.weighIns} readings) — a couple of weeks lets me read your trend.</p>
                ) : coach.inCooldown ? (
                  <p className="text-ink-400">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
                ) : null}
                {coach.proteinForGoal != null && coach.proteinForGoal !== (goalsOpen ? draft.protein : targets.protein) ? (
                  <button
                    onClick={() => applyProtein(coach.proteinForGoal!)}
                    className="flex items-center justify-between gap-2 text-left rounded-lg border border-accent-200 bg-cream-50 px-2.5 py-1.5 min-h-[44px] hover:bg-accent-50 transition-colors">
                    <span className="text-ink-600">Suggested <strong className="text-accent-700">{coach.proteinForGoal}g</strong> protein <span className="text-ink-400">· {(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg × {Math.round(coach.weightKg)}kg</span></span>
                    <span className="text-accent-600 font-semibold shrink-0">Apply</span>
                  </button>
                ) : coach.proteinForGoal != null ? (
                  <p className="text-green-600">✓ Protein target on point ({(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg)</p>
                ) : null}
                {coach.proteinPerMealG != null && (
                  <p className="text-ink-400">💪 ≈{coach.proteinPerMealG}g protein per meal spreads it best{coach.fatFloorG != null ? ` · keep fat ≥ ~${coach.fatFloorG}g/day on a cut` : ''}</p>
                )}
              </>
            )}
            </div>
          </div>
        </div>

        {/* Meal slots — fill the right column on wide screens. Cascade in on mobile. */}
        <div className="flex-1 min-w-0 grid grid-cols-1 2xl:grid-cols-2 gap-2.5 content-start stagger-in">
          {SLOTS.map(({ slot, label, icon }) => {
            const meals = bySlot.get(slot) ?? []
            const kcal = meals.filter(m => m.source === 'log').reduce((a, m) => a + m.calories, 0)
            return (
              <div key={slot} className="rounded-2xl border border-ink-200 bg-cream-50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-ink-100">
                  <span className="text-base leading-none">{icon}</span>
                  <span className="text-sm font-semibold text-ink-800 flex-1">{label}</span>
                  {kcal > 0 && <span className="text-xs text-ink-400 tabular-nums">{kcal} kcal</span>}
                  <button onClick={() => setLogSlot(slot)}
                    className="press-feedback text-xs font-semibold text-accent-600 hover:text-accent-700 min-h-[44px] px-2.5 rounded-lg transition-colors">+ Log</button>
                </div>
                {meals.length > 0 ? (
                  <ul className="divide-y divide-ink-50">
                    {groupDayMeals(meals).map(row => row.kind === 'group' ? groupHeaderLine(row) : mealLine(row.meal, false))}
                  </ul>
                ) : (
                  <button onClick={() => setLogSlot(slot)}
                    className="w-full flex items-center text-left px-4 min-h-[44px] text-xs text-ink-400 hover:text-accent-600 transition-colors">+ Add something</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {logSlot && <FoodLogModal open onClose={() => setLogSlot(null)} date={date} defaultSlot={logSlot} />}
      {editMeal && <EditFoodLogModal meal={editMeal} date={date} onClose={() => setEditMeal(null)} />}
      {planMeal && <AssignMealModal open onClose={() => setPlanMeal(null)} date={date} mealSlot={planMeal.meal_slot} existing={planMeal} />}
    </div>
  )
}
