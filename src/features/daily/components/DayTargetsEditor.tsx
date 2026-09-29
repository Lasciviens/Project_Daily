import { useState } from 'react'
import { Button, SegmentedControl } from '../../../shared/ui'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { DateInput } from '../../../shared/components/DateInput'
import { todayStr } from '../../../shared/utils/dateUtils'
import {
  bodyTargetText, parseBodyTargets, phaseStartFor, type BodyTargetField,
} from '../../health/goal/goalSettings'
import { useDayTargets, useDayTargetProfiles, type NutritionGoal, type DayTargets } from '../hooks/useDayTargets'
import { useNutritionCoach } from '../hooks/useNutritionCoach'
import { BodyTargetFields, EditorSection, GoalStepper, StepperRow } from './goalEditorParts'
import { GoalCoachBlock } from './GoalCoachBlock'

// ─────────────────────────────────────────────────────────────────────────────
//  "Your goal" — the ONE goal editor for Food, Daily and Health. Opened
//  through useEntityModal().open({ kind: 'day-targets' }); everything it
//  shows is one day_targets row (migrations 086 + 113), saved together.
//
//  • A DRAFT: nothing writes until Save. Seeded once from the saved goal.
//  • Phase: picking a phase recalls THAT phase's own saved daily targets
//    (migration 088). A phase with no saved targets gets a sensible starting
//    point — protein from bodyweight (`coach.proteinByGoal`), calories stepped
//    off Maintain's by ~−500 (cut) / ~+300 (gain), never below the floor. The
//    "since" date follows the phase: today for a new phase, the saved date
//    when you go back to the saved one; editable either way.
//  • Body targets are one set for every phase (owner decision).
//  • Coach "Apply" suggestions feed the draft.
// ─────────────────────────────────────────────────────────────────────────────

const PHASES: { value: NutritionGoal; label: string }[] = [
  { value: 'cut',      label: 'Cut' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain',     label: 'Gain' },
]

const textOf = (t: DayTargets): Record<BodyTargetField, string> => ({
  goalWeightKg: bodyTargetText(t.goalWeightKg), goalBodyFatPct: bodyTargetText(t.goalBodyFatPct), goalMuscleMassKg: bodyTargetText(t.goalMuscleMassKg),
})

export function DayTargetsEditor({ date = todayStr(), onClose }: { date?: string; onClose: () => void }) {
  const { targets, update, isSaving, isLoaded, fromDevice } = useDayTargets()
  const profiles = useDayTargetProfiles()
  const [draft, setDraft] = useState<DayTargets>(targets)
  const [bodyText, setBodyText] = useState(() => textOf(targets))
  const [errors, setErrors] = useState<Partial<Record<BodyTargetField, string>>>({})
  // Opened before the saved goal arrived → take it once it does (unless the
  // user already started editing the placeholder).
  const [seededFromReal, setSeededFromReal] = useState(isLoaded)
  const [touched, setTouched] = useState(false)
  if (isLoaded && !seededFromReal) {
    setSeededFromReal(true)
    if (!touched) { setDraft(targets); setBodyText(textOf(targets)) }
  }
  // Suggestions follow the phase being edited, not the one currently saved.
  const coach = useNutritionCoach(date, { ...targets, goal: draft.goal, calories: draft.calories })
  const patch = (p: Partial<DayTargets>) => { setTouched(true); setDraft(d => ({ ...d, ...p })) }
  const today = todayStr()

  function selectPhase(g: NutritionGoal) {
    const phaseStartDate = phaseStartFor(g, targets.goal, targets.phaseStartDate, today)
    const profile = profiles[g]
    if (profile) { patch({ goal: g, phaseStartDate, ...profile }); return }
    setTouched(true)
    setDraft(d => {
      const maintainCalories = profiles.maintain?.calories ?? d.calories
      const calorieDelta = g === 'cut' ? -500 : g === 'gain' ? 300 : 0
      const calories = g === 'maintain' ? maintainCalories : Math.max(coach.calorieFloor, maintainCalories + calorieDelta)
      const protein = coach.weightKg != null ? coach.proteinByGoal[g] : d.protein
      return { ...d, goal: g, phaseStartDate, calories, protein }
    })
  }

  function save() {
    const parsed = parseBodyTargets(bodyText)
    setErrors(parsed.errors)
    if (Object.keys(parsed.errors).length) return
    update({ ...draft, ...parsed.values })
    onClose()
  }

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save} loading={isSaving} disabled={!isLoaded}>Save goal</Button>
    </div>
  )

  return (
    <ModalShell onClose={onClose} title="Your goal" subtitle="One goal for Food, Daily and Health — saved together" size="lg" footer={footer}>
      {/* Two columns from sm: (phase + daily targets | body targets + coach);
          stacked in that order on a phone. */}
      <div className="grid gap-4 text-body sm:grid-cols-2 sm:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <EditorSection title="Phase" hint="Progress on Health → Goal progress is measured from the day the phase started.">
            <SegmentedControl options={PHASES} value={draft.goal} onChange={selectPhase} fullWidth />
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-2">Since</span>
              <DateInput value={draft.phaseStartDate ?? ''} onChange={v => patch({ phaseStartDate: v || null })} max={today}
                aria-label="Phase start date" placeholder="DD/MM/YYYY" className="input w-[9.5rem] tabular-nums" />
            </div>
          </EditorSection>

          <EditorSection title="Daily targets" hint="Each phase keeps its own daily targets — switch phase to recall them. Fibre ≈ 14 g per 1,000 kcal.">
            <StepperRow label="Calories">
              <GoalStepper label="Calorie target" value={draft.calories} step={50} suffix="kcal" onChange={v => patch({ calories: v })} />
            </StepperRow>
            {draft.calories < coach.calorieFloor && (
              <p data-tone="danger" className="tone-text -mt-1 text-meta">
                Below a safe floor (~{coach.calorieFloor} kcal). Don&apos;t cut lower — take a diet break instead.
              </p>
            )}
            <StepperRow label="Protein">
              <GoalStepper label="Protein target" value={draft.protein} step={10} suffix="g" onChange={v => patch({ protein: v })} />
            </StepperRow>
            <StepperRow label="Water">
              <GoalStepper label="Water target" value={draft.water} step={250} suffix="ml" onChange={v => patch({ water: v })} />
            </StepperRow>
          </EditorSection>
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-line pt-3 sm:border-t-0 sm:pt-0">
          <EditorSection title="Body targets"
            hint={<>One set for every phase — leave a box empty for no target. Muscle is the scale report&apos;s muscle % × weight, not lean mass.{fromDevice && ' Some values are still stored on this device only; saving moves them to your account.'}</>}>
            <BodyTargetFields text={bodyText} errors={errors} now={{ goalWeightKg: coach.weightKg }}
              onChange={(f, v) => { setTouched(true); setBodyText(t => ({ ...t, [f]: v })) }} />
          </EditorSection>

          <GoalCoachBlock coach={coach} draft={draft} patch={patch} />
        </div>
      </div>
    </ModalShell>
  )
}
