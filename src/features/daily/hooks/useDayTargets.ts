import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchDayTargets, upsertDayTargets, fetchDayTargetProfiles, DAY_TARGETS_DEFAULTS } from '../api/dayTargetsApi'
import type { DayTargets, NutritionGoal, DayTargetProfiles } from '../api/dayTargetsApi'

export type { DayTargets, NutritionGoal, DayTargetProfiles }

// Daily nutrition goals — one ACTIVE DB row per user (migration 086,
// day_targets), no longer localStorage-only. `placeholderData` (NOT
// `initialData`) seeds the same DEFAULTS the old localStorage version
// shipped so every consumer (NutritionCard, FoodTodayTab, WaterTracker,
// useNutritionCoach) keeps rendering instantly on first paint — but,
// unlike `initialData`, it does NOT mark the query as already-fetched-and-
// fresh. REAL BUG this fixes: `initialData` stamps `dataUpdatedAt` as "now"
// the instant the hook mounts, so combined with `staleTime: 5min` the query
// read as fresh from the very first render and `fetchDayTargets` never
// actually ran on a normal page load — every reload silently kept showing
// the hardcoded defaults instead of the real saved goal, reading exactly
// like "the DB save isn't working" even though every write DOES land (a
// save's own `onSettled` invalidate was the only thing that ever forced a
// real fetch, which is why editing a goal right after loading could look
// like it worked while a page RELOAD reverted it). `placeholderData`
// renders the same instant fallback without suppressing the mount-time fetch.
const QK = ['day-targets'] as const
const PROFILES_QK = ['day-target-profiles'] as const

export function useDayTargets() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: QK,
    queryFn:  fetchDayTargets,
    staleTime: 5 * 60_000,
    placeholderData: DAY_TARGETS_DEFAULTS,
  })
  const targets = data ?? DAY_TARGETS_DEFAULTS

  // `update` is the immediate-write path — used by the Coach's one-tap
  // "Apply" suggestions (a single deliberate action, not a background
  // autosave) and by the Goals editor's own explicit Save button. Optimistic
  // so either still feels instant.
  const mutation = useMutationWithFeedback<DayTargets, DayTargets, { previous?: DayTargets; previousProfiles?: DayTargetProfiles }>({
    action:         'update_day_targets',
    successMessage: 'Saved ✓',
    mutationFn:     (next: DayTargets) => upsertDayTargets(next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: QK })
      await qc.cancelQueries({ queryKey: PROFILES_QK })
      const previous = qc.getQueryData<DayTargets>(QK)
      const previousProfiles = qc.getQueryData<DayTargetProfiles>(PROFILES_QK)
      qc.setQueryData(QK, next)
      // Also reflect THIS goal's just-saved numbers into the profiles cache
      // immediately — without this, switching goals right after Save (before
      // the background refetch below completes) could still read the
      // pre-save profile and look like the save didn't actually happen.
      qc.setQueryData<DayTargetProfiles>(PROFILES_QK, (old) => ({
        ...(old ?? {}),
        [next.goal]: { calories: next.calories, protein: next.protein, water: next.water },
      }))
      return { previous, previousProfiles }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(QK, ctx.previous)
      if (ctx?.previousProfiles) qc.setQueryData(PROFILES_QK, ctx.previousProfiles)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QK })
      qc.invalidateQueries({ queryKey: PROFILES_QK })
    },
  })

  const update = useCallback((patch: Partial<DayTargets>) => {
    mutation.mutate({ ...targets, ...patch })
  }, [targets, mutation])

  return { targets, update, isSaving: mutation.isPending }
}

// One saved {calories, protein, water} set per goal (migration 088) — the
// Goals editor's own per-goal memory: switching Cut → Maintain → Cut recalls
// what was last saved for Cut instead of carrying over Maintain's numbers.
export function useDayTargetProfiles() {
  const { data } = useQuery({
    queryKey: PROFILES_QK,
    queryFn:  fetchDayTargetProfiles,
    staleTime: 5 * 60_000,
    placeholderData: {} as DayTargetProfiles,
  })
  return data ?? {}
}
