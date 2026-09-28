import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchDayTargets, upsertDayTargets, fetchDayTargetProfiles, DAY_TARGETS_PLACEHOLDER } from '../api/dayTargetsApi'
import type { DayTargets, DayTargetsState, DayTargetsSaveResult, NutritionGoal, DayTargetProfiles } from '../api/dayTargetsApi'
import { toast } from '../../../app/store'

export type { DayTargets, NutritionGoal, DayTargetProfiles }

// The goal — phase + start date, daily targets and body targets — one DB row
// per user (day_targets, migrations 086 + 113). Every screen reads it here:
// NutritionCard, FoodTodayTab, WaterTracker, useNutritionCoach, the goal
// editor, Health's Goal progress and Overview.
//
// `placeholderData` (NOT `initialData`) renders the defaults instantly
// WITHOUT marking the query fresh. REAL BUG this once fixed: `initialData`
// stamps `dataUpdatedAt` as "now", so with a 5-minute staleTime the fetch
// never ran on a normal load and every reload showed the defaults instead of
// the saved goal — reading exactly like "saving doesn't work".
const QK = qk.dayTargets.all
const PROFILES_QK = qk.dayTargets.profiles

export function useDayTargets() {
  const qc = useQueryClient()
  const { data, isPlaceholderData } = useQuery({
    queryKey: QK,
    queryFn:  fetchDayTargets,
    staleTime: STALE.default,
    placeholderData: DAY_TARGETS_PLACEHOLDER,
  })
  const state = data ?? DAY_TARGETS_PLACEHOLDER
  const targets = state.targets

  // `update` is the immediate-write path — the goal editor's Save and the
  // Coach's one-tap "Apply" suggestions (a single deliberate action, not a
  // background autosave). Optimistic so either still feels instant.
  // `loaded` is the goal the edit started from — before migration 113 an
  // edit that leaves the body goals alone doesn't write (or warn about) them.
  const mutation = useMutationWithFeedback<DayTargetsSaveResult, { next: DayTargets; loaded: DayTargetsState }, { previous?: DayTargetsState; previousProfiles?: DayTargetProfiles }>({
    action:         'update_day_targets',
    successMessage: 'Goal saved',
    mutationFn:     ({ next, loaded }) => upsertDayTargets(next, loaded),
    onMutate: async ({ next }) => {
      await qc.cancelQueries({ queryKey: QK })
      await qc.cancelQueries({ queryKey: PROFILES_QK })
      const previous = qc.getQueryData<DayTargetsState>(QK)
      const previousProfiles = qc.getQueryData<DayTargetProfiles>(PROFILES_QK)
      qc.setQueryData<DayTargetsState>(QK, { targets: next, fromDevice: previous?.fromDevice ?? false })
      // THIS phase's just-saved numbers go into the profiles cache at once, so
      // switching phases right after Save can't read the pre-save profile.
      qc.setQueryData<DayTargetProfiles>(PROFILES_QK, (old) => ({
        ...(old ?? {}),
        [next.goal]: { calories: next.calories, protein: next.protein, water: next.water },
      }))
      return { previous, previousProfiles }
    },
    onSuccess: (r) => {
      qc.setQueryData<DayTargetsState>(QK, r.state)
      if (r.bodyGoalsSavedTo === 'profile') {
        toast.warning('Body targets were saved to your training profile — migration 113 isn’t applied yet, so the goal isn’t in one place.')
      } else if (r.bodyGoalsSavedTo === 'device') {
        toast.warning('Body targets were saved on this device only — migrations 111 and 113 aren’t applied yet.')
      }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(QK, ctx.previous)
      if (ctx?.previousProfiles) qc.setQueryData(PROFILES_QK, ctx.previousProfiles)
    },
    invalidates: [QK, PROFILES_QK, qk.athlete.profile],
  })

  // Until the real row has loaded, `targets` are the placeholder defaults —
  // spreading them into a write would overwrite the saved goal.
  const update = useCallback((patch: Partial<DayTargets>) => {
    if (isPlaceholderData) { toast.warning('Your goal is still loading — try again in a moment'); return }
    mutation.mutate({ next: { ...targets, ...patch }, loaded: state })
  }, [targets, state, mutation, isPlaceholderData])

  return { targets, update, fromDevice: state.fromDevice, isSaving: mutation.isPending, isLoaded: !isPlaceholderData }
}

// One saved {calories, protein, water} set per phase (migration 088) — the
// editor's per-phase memory: switching Cut → Maintain → Cut recalls what was
// last saved for Cut instead of carrying over Maintain's numbers.
export function useDayTargetProfiles() {
  const { data } = useQuery({
    queryKey: PROFILES_QK,
    queryFn:  fetchDayTargetProfiles,
    staleTime: STALE.default,
    placeholderData: {} as DayTargetProfiles,
  })
  return data ?? {}
}
