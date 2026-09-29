import { useCallback, useMemo } from 'react'
import { useDayTargets } from '../../daily/hooks/useDayTargets'
import type { GoalSettings } from './goalSettings'

// The goal lives in ONE place — the day_targets row (migration 113), read and
// saved through useDayTargets — and is edited in ONE editor (the `day-targets`
// popup, "Your goal"). These two hooks are the goal report's view of it.

/** Goal weight / body fat % / muscle mass and the phase start. */
export function useBodyGoals() {
  const { targets, fromDevice, update, isSaving, isLoaded } = useDayTargets()
  const { goalWeightKg, goalBodyFatPct, goalMuscleMassKg, phaseStartDate } = targets
  const settings: GoalSettings = useMemo(
    () => ({ goalWeightKg, goalBodyFatPct, goalMuscleMassKg, phaseStartDate }),
    [goalWeightKg, goalBodyFatPct, goalMuscleMassKg, phaseStartDate],
  )
  const save = useCallback((next: GoalSettings) => update(next), [update])
  return { settings, fromDevice, save, isSaving, isLoading: !isLoaded }
}

/** The phase (cut / maintain / gain) and its daily targets — read-only here;
 *  changing it goes through the goal editor so the phase, its start date and
 *  the targets save together. */
export function usePhase() {
  const { targets, isLoaded } = useDayTargets()
  return { phase: targets.goal, targetKcal: targets.calories, targetProtein: targets.protein, phaseStartDate: targets.phaseStartDate, isLoaded }
}
