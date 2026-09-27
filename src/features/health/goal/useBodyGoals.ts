import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../../shared/query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { toast } from '../../../app/store'
import { useAthleteProfile } from '../../training/hooks/useAthleteProfile'
import { useDayTargets, useDayTargetProfiles, type NutritionGoal } from '../../daily/hooks/useDayTargets'
import { EMPTY_GOAL_SETTINGS, resolveGoalSettings, type GoalSettings } from './goalSettings'
import { readLocalGoals, saveBodyGoals, type SaveGoalsResult } from './goalSettingsApi'

/** Goal weight / body fat % / muscle mass and the phase start: the account's
 *  values (migration 111), device-local ones filling the gaps until the first
 *  save moves them over. */
export function useBodyGoals() {
  const qc = useQueryClient()
  const profile = useAthleteProfile()
  const [local, setLocal] = useState<GoalSettings>(readLocalGoals)
  const { settings, fromDevice } = useMemo(() => resolveGoalSettings(profile.data ?? null, local), [profile.data, local])

  const mutation = useMutationWithFeedback<SaveGoalsResult, GoalSettings>({
    action: 'save_body_goals',
    mutationFn: saveBodyGoals,
    successMessage: r => (r.where === 'account' ? 'Goals saved' : undefined),
    onSuccess: (r, next) => {
      if (r.where === 'account') {
        // The saved row, so the form doesn't flash the old values while the refetch runs.
        qc.setQueryData(qk.athlete.profile, r.profile)
        setLocal(EMPTY_GOAL_SETTINGS)
      } else {
        setLocal(next)
        toast.warning('Goals saved on this device only — migration 111 isn’t applied yet')
      }
    },
    invalidates: [qk.athlete.profile],
  })

  const save = useCallback((next: GoalSettings) => mutation.mutateAsync(next), [mutation])
  return { settings, fromDevice, save, isSaving: mutation.isPending, isLoading: profile.isLoading }
}

/** The phase is the nutrition goal (day_targets.goal) — one place for "am I
 *  cutting?". Switching recalls that phase's own saved calorie/protein/water
 *  targets (migration 088) when there are any, like the Goals editor does. */
export function usePhase() {
  const { targets, update, isLoaded, isSaving } = useDayTargets()
  const profiles = useDayTargetProfiles()
  const setPhase = useCallback((goal: NutritionGoal) => {
    if (goal === targets.goal) return
    const saved = profiles[goal]
    update(saved ? { goal, calories: saved.calories, protein: saved.protein, water: saved.water } : { goal })
  }, [targets.goal, profiles, update])
  return { phase: targets.goal, targetKcal: targets.calories, targetProtein: targets.protein, setPhase, isLoaded, isSaving, hasSavedTargets: (g: NutritionGoal) => !!profiles[g] }
}
