import { useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useDayTargets, useDayTargetProfiles, type NutritionGoal, type DayTargets } from '../hooks/useDayTargets'
import { useNutritionCoach } from '../hooks/useNutritionCoach'

// ─────────────────────────────────────────────────────────────────────────────
//  The ONE nutrition-goals editor (was copy-pasted into NutritionCard and
//  FoodTodayTab). Opened through useEntityModal().open({ kind: 'day-targets' }).
//
//  • A DRAFT: nothing writes until Save. Seeded once from the active targets
//    when the editor mounts, so it always starts from what is really saved.
//  • Goal pills recall THAT goal's own saved numbers (migration 088). A goal
//    with no saved profile yet gets a sensible different starting point —
//    protein from bodyweight (`coach.proteinByGoal`), calories stepped off
//    Maintain's saved number by ~−500 (cut) / ~+300 (gain), never below the
//    calorie floor — instead of numbers that sit frozen ("picking Cut does
//    nothing"). Saving a goal replaces the fallback with its real profile.
//  • Coach "Apply" suggestions inside the editor feed the draft, so a pending
//    manual edit and a suggestion never clobber each other.
// ─────────────────────────────────────────────────────────────────────────────

const GOALS: { id: NutritionGoal; label: string }[] = [
  { id: 'maintain', label: 'Maintain' },
  { id: 'cut',      label: 'Cut' },
  { id: 'gain',     label: 'Gain' },
]

// −/+ stepper: goals move in meaningful steps (kcal by 50, protein by 10)
// instead of a native ±1 spinner; the field stays typeable. Clamped at 0.
function GoalStepper({ label, value, step, suffix, onChange }: {
  label: string; value: number; step: number; suffix: string; onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.max(0, v))
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`${label} −${step}`} onClick={() => set(value - step)} className="icon-btn-bordered">
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <div className="relative">
        <input
          type="number" value={value} min={0} step={step} aria-label={label}
          onChange={e => set(Number(e.target.value) || 0)}
          // The native spinner would duplicate the −/+ buttons flanking it.
          className="input w-24 pr-10 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-meta text-fg-muted">{suffix}</span>
      </div>
      <button type="button" aria-label={`${label} +${step}`} onClick={() => set(value + step)} className="icon-btn-bordered">
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function Suggestion({ children, onApply }: { children: ReactNode; onApply: () => void }) {
  return (
    <button
      type="button" onClick={onApply}
      className="row row-interactive justify-between border border-accent-500/25 bg-accent-50 text-left text-meta"
    >
      <span className="text-fg-2">{children}</span>
      <span className="shrink-0 font-semibold text-accent-600">Apply</span>
    </button>
  )
}

export function DayTargetsEditor({ date = todayStr(), onDone }: { date?: string; onDone: () => void }) {
  const { targets, update, isSaving } = useDayTargets()
  const profiles = useDayTargetProfiles()
  const coach = useNutritionCoach(date, targets)
  const [draft, setDraft] = useState<DayTargets>(targets)
  const patch = (p: Partial<DayTargets>) => setDraft(d => ({ ...d, ...p }))

  function selectGoal(g: NutritionGoal) {
    const profile = profiles[g]
    if (profile) { patch({ goal: g, ...profile }); return }
    setDraft(d => {
      const maintainCalories = profiles.maintain?.calories ?? d.calories
      const calorieDelta = g === 'cut' ? -500 : g === 'gain' ? 300 : 0
      const calories = g === 'maintain' ? maintainCalories : Math.max(coach.calorieFloor, maintainCalories + calorieDelta)
      const protein = coach.weightKg != null ? coach.proteinByGoal[g] : d.protein
      return { ...d, goal: g, calories, protein }
    })
  }

  function save() {
    update(draft)
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 text-body">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-2">Goal</span>
        <div role="radiogroup" aria-label="Goal" className="seg">
          {GOALS.map(g => (
            <button key={g.id} type="button" role="radio" aria-checked={draft.goal === g.id}
              onClick={() => selectGoal(g.id)} className="seg-btn">
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-2">Calories</span>
        <GoalStepper label="Calorie goal" value={draft.calories} step={50} suffix="kcal" onChange={v => patch({ calories: v })} />
      </div>
      {draft.calories < coach.calorieFloor && (
        <p data-tone="danger" className="tone-text -mt-1 text-meta">
          Below a safe floor (~{coach.calorieFloor} kcal). Don't cut lower — take a diet break instead.
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-2">Protein</span>
        <GoalStepper label="Protein goal" value={draft.protein} step={10} suffix="g" onChange={v => patch({ protein: v })} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-2">Water</span>
        <GoalStepper label="Water goal" value={draft.water} step={250} suffix="ml" onChange={v => patch({ water: v })} />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <p className="section-label">Coach</p>
        {coach.weightKg == null ? (
          <p className="text-meta text-fg-muted">Sync or add a bodyweight (Training → Body) to get protein and calorie suggestions.</p>
        ) : (
          <>
            {coach.proteinForGoal != null && coach.proteinForGoal !== draft.protein ? (
              <Suggestion onApply={() => patch({ protein: coach.proteinForGoal! })}>
                Suggested <strong className="text-accent-700">{coach.proteinForGoal}g</strong> protein
                <span className="text-fg-muted"> · {(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg × {Math.round(coach.weightKg)}kg</span>
              </Suggestion>
            ) : coach.proteinForGoal != null ? (
              <p data-tone="success" className="tone-text text-meta">Protein on target ({(coach.proteinForGoal / coach.weightKg).toFixed(1)} g/kg).</p>
            ) : null}

            {coach.fatFloorG != null && (
              <p className="text-meta text-fg-muted">Keep fat ≥ ~{coach.fatFloorG}g/day on a cut (hormonal health).</p>
            )}

            {coach.calorieAdvice ? (
              <Suggestion onApply={() => patch({ calories: Math.max(coach.calorieFloor, draft.calories + coach.calorieAdvice!.delta), lastCalorieAdjust: todayStr() })}>
                <strong className="text-accent-700">{coach.calorieAdvice.delta > 0 ? '+' : ''}{coach.calorieAdvice.delta} kcal</strong>
                <span className="text-fg-muted"> · {coach.calorieAdvice.reason}</span>
              </Suggestion>
            ) : coach.onTrack ? (
              <p data-tone="success" className="tone-text text-meta">{coach.onTrack}</p>
            ) : coach.atFloor ? (
              <p className="text-meta text-fg-muted">You're at your calorie floor (~{coach.calorieFloor}) but not losing — take a diet break rather than cutting lower.</p>
            ) : coach.inCooldown ? (
              <p className="text-meta text-fg-muted">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
            ) : !coach.consistent ? (
              <p className="text-meta text-fg-muted">Logged {coach.loggedDays7} of the last 7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock calorie coaching.</p>
            ) : !coach.weighInsOk ? (
              <p className="text-meta text-fg-muted">Weigh in more often ({coach.weighIns} readings) — a couple of weeks of regular weigh-ins lets me read your trend.</p>
            ) : null}
          </>
        )}
      </div>

      <p className="text-meta leading-relaxed text-fg-muted">
        Each goal (Cut / Maintain / Gain) keeps its own saved numbers — switch goals to recall them, adjust, then save.
        Fiber goal ≈ 14g per 1000 kcal.
      </p>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={isSaving}>Save goals</Button>
      </div>
    </div>
  )
}
