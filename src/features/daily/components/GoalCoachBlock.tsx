import { todayStr } from '../../../shared/utils/dateUtils'
import type { DayTargets } from '../hooks/useDayTargets'
import type { NutritionCoach } from '../hooks/useNutritionCoach'
import { EditorSection, Suggestion } from './goalEditorParts'

/** The coach's suggestions inside the goal editor. "Apply" feeds the draft,
 *  so a pending manual edit and a suggestion never clobber each other. */
export function GoalCoachBlock({ coach, draft, patch }: {
  coach: NutritionCoach; draft: DayTargets; patch: (p: Partial<DayTargets>) => void
}) {
  return (
    <EditorSection title="Coach">
      {coach.weightKg == null ? (
        <p className="text-meta text-fg-muted">Sync or add a bodyweight (weigh in on your scale, or log one in Health → Body) to get protein and calorie suggestions.</p>
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
            <p className="text-meta text-fg-muted">You&apos;re at your calorie floor (~{coach.calorieFloor}) — don&apos;t cut lower; take a diet break instead.</p>
          ) : coach.inCooldown ? (
            <p className="text-meta text-fg-muted">Calorie adjusted recently — hold {coach.cooldownDaysLeft} more day{coach.cooldownDaysLeft === 1 ? '' : 's'} so the trend can catch up.</p>
          ) : !coach.consistent ? (
            <p className="text-meta text-fg-muted">Logged {coach.loggedDays7} of the last 7 days — log {Math.max(1, 4 - coach.loggedDays7)} more to unlock calorie coaching.</p>
          ) : !coach.weighInsOk ? (
            <p className="text-meta text-fg-muted">Weigh in more often ({coach.weighIns} readings) — a couple of weeks of regular weigh-ins lets me read your trend.</p>
          ) : null}
        </>
      )}
    </EditorSection>
  )
}
