import { todayStr } from '../../../shared/utils/dateUtils'
import type { DayTargets } from '../hooks/useDayTargets'
import type { NutritionCoach } from '../hooks/useNutritionCoach'
import { EditorSection } from './goalEditorParts'
import { CoachDecisionView } from './CoachDecision'

/** The coach inside the goal editor — the same decision as Food and Health
 *  (cutDecision.ts). "Apply" feeds the draft, so a pending manual edit and a
 *  suggestion never clobber each other. */
export function GoalCoachBlock({ coach, draft, patch }: {
  coach: NutritionCoach; draft: DayTargets; patch: (p: Partial<DayTargets>) => void
}) {
  return (
    <EditorSection title="Coach">
      <CoachDecisionView coach={coach} currentProtein={draft.protein}
        onApplyCalories={kcal => patch({ calories: kcal, lastCalorieAdjust: todayStr() })}
        onApplyProtein={g => patch({ protein: g })} />
    </EditorSection>
  )
}
